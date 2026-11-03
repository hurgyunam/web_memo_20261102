import { connect as connectNet, type Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'

export class MailDeliveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailDeliveryError'
  }
}

export type SmtpSettings = {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
}

export type SmtpMessage = {
  to: string
  subject: string
  text: string
}

export function resolveSmtpSettings(
  env: Record<string, string | undefined> = process.env,
): SmtpSettings | null {
  const host = text(env.SMTP_HOST)
  const user = text(env.SMTP_USER)
  const pass = text(env.SMTP_PASS)
  if (!host || !user || !pass) {
    return null
  }
  const port = Number(text(env.SMTP_PORT) || '465')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MailDeliveryError('메일 전송 설정이 올바르지 않습니다.')
  }
  const from = text(env.MAIL_FROM) || mailbox(host, user)
  assertLine(from)
  assertLine(user)
  assertLine(pass)
  return {
    host,
    port,
    secure: port === 465,
    user: authUser(host, user),
    pass,
    from,
  }
}

export async function sendSmtpMail(settings: SmtpSettings, message: SmtpMessage): Promise<void> {
  assertLine(message.to)
  const socket = settings.secure
    ? connectTls({ host: settings.host, port: settings.port, servername: settings.host })
    : connectNet({ host: settings.host, port: settings.port })
  const session = new SmtpSession(socket, settings.pass)
  try {
    await session.waitUntil(settings.secure ? 'secureConnect' : 'connect')
    await session.expect(null, 220)
    await session.expect('EHLO localhost', 250)
    await session.expect('AUTH LOGIN', 334)
    await session.expect(Buffer.from(settings.user).toString('base64'), 334)
    await session.expect(Buffer.from(settings.pass).toString('base64'), 235)
    await session.expect(`MAIL FROM:<${addressOnly(settings.from)}>`, 250)
    await session.expect(`RCPT TO:<${addressOnly(message.to)}>`, 250)
    await session.expect('DATA', 354)
    await session.expect(messageData(settings.from, message), 250)
    await session.expect('QUIT', 221)
  } catch (error) {
    socket.destroy()
    if (error instanceof MailDeliveryError) {
      throw error
    }
    throw new MailDeliveryError('메일 전송에 실패했습니다.')
  } finally {
    session.finish()
  }
}

function messageData(from: string, message: SmtpMessage): string {
  const body = message.text.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')
  const stuffed = body.split('\r\n').map((line) => line.startsWith('.') ? `.${line}` : line).join('\r\n')
  return [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    stuffed,
    '.',
  ].join('\r\n')
}

function encodeHeader(value: string): string {
  if (/^[\t\x20-\x7E]*$/.test(value)) {
    return value
  }
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function addressOnly(value: string): string {
  const wrapped = /<([^>]+)>/.exec(value)
  return (wrapped?.[1] ?? value).trim()
}

function authUser(host: string, user: string): string {
  if (host.toLowerCase() === 'smtp.naver.com' && user.toLowerCase().endsWith('@naver.com')) {
    return user.slice(0, user.length - '@naver.com'.length)
  }
  return user
}

function mailbox(host: string, user: string): string {
  if (user.includes('@')) {
    return user
  }
  if (host.toLowerCase() === 'smtp.naver.com') {
    return `${user}@naver.com`
  }
  return user
}

function assertLine(value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new MailDeliveryError('메일 주소가 올바르지 않습니다.')
  }
}

function text(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

class SmtpSession {
  private buffer = ''
  private failed: Error | null = null
  private done = false
  private waiters: Array<() => void> = []

  constructor(
    private readonly socket: Socket,
    private readonly pass: string,
  ) {
    socket.setEncoding('utf8')
    socket.setTimeout(20_000)
    socket.on('data', (chunk: string) => {
      this.buffer += chunk
      this.wake()
    })
    socket.on('timeout', () => {
      this.fail(new MailDeliveryError('메일 서버 응답이 없습니다.'))
    })
    socket.on('error', () => {
      this.fail(new MailDeliveryError('메일 전송에 실패했습니다.'))
    })
    socket.on('end', () => {
      if (!this.done) {
        this.fail(new MailDeliveryError('메일 서버 연결이 끊겼습니다.'))
      }
    })
  }

  waitUntil(event: 'connect' | 'secureConnect'): Promise<void> {
    if (this.failed) {
      return Promise.reject(this.failed)
    }
    return new Promise((resolve, reject) => {
      this.socket.once(event, () => resolve())
      this.socket.once('error', () => reject(this.failed ?? new MailDeliveryError('메일 전송에 실패했습니다.')))
    })
  }

  async expect(line: string | null, code: number): Promise<void> {
    if (line !== null) {
      this.socket.write(`${line}\r\n`)
    }
    const reply = await this.readReply()
    if (reply.code !== code) {
      const detail = reply.lines.join(' ').split(this.pass).join('')
      if (reply.code === 535) {
        throw new MailDeliveryError('애플리케이션 비밀번호로 로그인하지 못했습니다.')
      }
      throw new MailDeliveryError(`메일 전송에 실패했습니다. ${detail}`)
    }
  }

  finish(): void {
    this.done = true
    this.socket.setTimeout(0)
    if (!this.socket.destroyed) {
      this.socket.end()
    }
  }

  private async readReply(): Promise<{ code: number, lines: string[] }> {
    while (true) {
      const reply = takeReply(this.buffer)
      if (reply) {
        this.buffer = reply.rest
        return reply
      }
      if (this.failed) {
        throw this.failed
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
      })
    }
  }

  private fail(error: Error): void {
    if (this.done || this.failed) {
      return
    }
    this.failed = error
    this.wake()
  }

  private wake(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) {
      waiter()
    }
  }
}

function takeReply(buffer: string): { code: number, lines: string[], rest: string } | null {
  const lines: string[] = []
  let rest = buffer
  while (true) {
    const newline = rest.indexOf('\n')
    if (newline < 0) {
      return null
    }
    const line = rest.slice(0, newline).replace(/\r$/, '')
    const next = rest.slice(newline + 1)
    const match = /^(\d{3})([ -])(.*)$/.exec(line)
    if (!match) {
      throw new MailDeliveryError('메일 전송에 실패했습니다.')
    }
    lines.push(line)
    rest = next
    if (match[2] === ' ') {
      return { code: Number(match[1]), lines, rest }
    }
  }
}
