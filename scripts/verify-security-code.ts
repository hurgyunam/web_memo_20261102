import { createServer as createNetServer } from 'node:net'
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Socket } from 'node:net'
import { createClient, type Client } from '@libsql/client'
import { createEvent } from 'h3'
import { hashPassword, verifyPassword } from '../server/db/passwords'
import {
  applyPasswordChangeCookie,
  passwordChangeCookieOptions,
} from '../server/db/password-change-cookie'
import {
  findAccountByEmail,
  findPasswordChangeGrant,
  insertAccount,
  replacePasswordChangeGrant,
  updateAccountPassword,
  StorageError,
} from '../server/db/records'
import { ensureSchema } from '../server/db/schema'
import {
  consumeSecurityCode,
  issueSecurityCode,
  SECURITY_CODE_TTL_MS,
} from '../server/db/security-code'
import { applySessionCookie, createSessionToken, hashSessionToken } from '../server/db/session-cookie'
import { deliverSecurityCodeEmail, renderSecurityCodeMail } from '../server/utils/mail'
import { MailDeliveryError, resolveSmtpSettings, sendSmtpMail } from '../server/utils/smtp'

const root = process.cwd()

async function main(): Promise<void> {
  assertSingleTtl()
  assertApiRoutesHideSecrets()
  assertMailText()
  assertSmtpSettings()
  await assertSmtpDialogue()
  await assertOutboxDelivery()
  assertGrantCookie()
  await verifyCodes()
  console.log('보안코드 로그인과 비밀번호 변경 검증을 통과했습니다.')
}

function assertSingleTtl(): void {
  const sources = walk(join(root, 'server')).filter((file) => file.endsWith('.ts'))
  const assignments = sources.filter((file) => /SECURITY_CODE_TTL_MS\s*=/.test(readFileSync(file, 'utf8')))
  assert(assignments.length === 1, '보안코드 제한 시간이 여러 곳에 있습니다.')
  assert(SECURITY_CODE_TTL_MS === 10 * 60 * 1000, '보안코드 제한 시간이 10분이 아닙니다.')
  const access = readFileSync(join(root, 'server', 'utils', 'account-access.ts'), 'utf8')
  assert(!access.includes('ttlMs'), '요청 경로가 제한 시간을 따로 받습니다.')
  const accept = sliceFunction(access, 'export async function acceptChangeCode')
  const save = sliceFunction(access, 'export async function saveNewSecret')
  assert(!accept.includes('openSession'), '비밀번호 변경 인증이 세션을 엽니다.')
  assert(!save.includes('openSession'), '비밀번호 저장이 세션을 엽니다.')
  assert(sliceFunction(access, 'export async function signInWithSecurityCode').includes('openSession'), '로그인 코드 인증이 세션을 열지 않습니다.')
}

function assertApiRoutesHideSecrets(): void {
  for (const file of walk(join(root, 'server', 'api'))) {
    const source = readFileSync(file, 'utf8')
    assert(!source.includes('password'), `${file} 응답 경로에 비밀번호가 있습니다.`)
    assert(!source.includes('securityCode'), `${file} 응답 경로에 보안코드 값이 있습니다.`)
    assert(!/\bcode\b/.test(source), `${file} 응답 경로에 코드가 있습니다.`)
  }
}

function assertMailText(): void {
  const login = renderSecurityCodeMail({ to: 'user@example.com', purpose: 'login', code: '01234567' })
  const change = renderSecurityCodeMail({ to: 'user@example.com', purpose: 'password_change', code: '76543210' })
  assert(login.subject === '로그인 보안코드', '로그인 메일 제목이 다릅니다.')
  assert(change.subject === '비밀번호 변경 보안코드', '비밀번호 변경 메일 제목이 다릅니다.')
  assert(login.text.includes('01234567'), '로그인 메일에 코드가 없습니다.')
  assert(change.text.includes('76543210'), '비밀번호 변경 메일에 코드가 없습니다.')
  assert(login.text.includes('10분'), '메일이 제한 시간을 빠뜨렸습니다.')
  assert(!login.text.includes('76543210'), '로그인 메일에 다른 코드가 있습니다.')
  assert(!login.text.toLowerCase().includes('scrypt'), '메일에 해시가 있습니다.')
}

function assertSmtpSettings(): void {
  const settings = resolveSmtpSettings({
    SMTP_HOST: 'smtp.naver.com',
    SMTP_PORT: '465',
    SMTP_USER: 'memo-user',
    SMTP_PASS: 'app-secret',
  })
  assert(settings?.host === 'smtp.naver.com', 'SMTP 서버가 다릅니다.')
  assert(settings?.port === 465, 'SMTP 포트가 다릅니다.')
  assert(settings?.secure === true, '465 포트가 보안 연결이 아닙니다.')
  assert(settings?.user === 'memo-user', '네이버 아이디를 그대로 쓰지 않습니다.')
  assert(settings?.from === 'memo-user@naver.com', '보내는 주소가 네이버 메일이 아닙니다.')
  assert(settings?.pass === 'app-secret', '애플리케이션 비밀번호를 읽지 못했습니다.')
  const withDomain = resolveSmtpSettings({
    SMTP_HOST: 'smtp.naver.com',
    SMTP_USER: 'memo-user@naver.com',
    SMTP_PASS: 'app-secret',
    MAIL_FROM: 'memo-user@naver.com',
  })
  assert(withDomain?.user === 'memo-user', '네이버 주소에서 아이디를 빼지 않습니다.')
  assert(resolveSmtpSettings({}) === null, '비어 있는 SMTP 설정을 통과시켰습니다.')
}

async function assertSmtpDialogue(): Promise<void> {
  const received: string[] = []
  const server = createNetServer((socket) => {
    socket.write('220 local\r\n')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\r\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        received.push(line)
        if (line === 'EHLO localhost') {
          socket.write('250-PIPELINING\r\n250 hello\r\n')
        } else if (line === 'AUTH LOGIN') {
          socket.write('334 VXNlcm5hbWU6\r\n')
        } else if (line === Buffer.from('memo-user').toString('base64')) {
          socket.write('334 UGFzc3dvcmQ6\r\n')
        } else if (line === Buffer.from('app-secret').toString('base64')) {
          socket.write('235 ok\r\n')
        } else if (line.startsWith('MAIL FROM:')) {
          socket.write('250 ok\r\n')
        } else if (line.startsWith('RCPT TO:')) {
          socket.write('250 ok\r\n')
        } else if (line === 'DATA') {
          socket.write('354 go\r\n')
        } else if (line === '.') {
          socket.write('250 queued\r\n')
        } else if (line === 'QUIT') {
          socket.write('221 bye\r\n')
        }
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('SMTP 확인 서버의 포트를 열지 못했습니다.')
  }
  try {
    await sendSmtpMail({
      host: '127.0.0.1',
      port: address.port,
      secure: false,
      user: 'memo-user',
      pass: 'app-secret',
      from: 'memo-user@naver.com',
    }, {
      to: 'person@example.com',
      subject: '로그인 보안코드',
      text: '보안코드는 01234567 입니다.',
    })
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
  const transcript = received.join('\n')
  assert(transcript.includes('MAIL FROM:<memo-user@naver.com>'), '보내는 주소가 SMTP에 없습니다.')
  assert(transcript.includes('RCPT TO:<person@example.com>'), '받는 주소가 SMTP에 없습니다.')
  assert(transcript.includes('01234567'), 'SMTP 본문에 보안코드가 없습니다.')
  assert(!transcript.includes('app-secret'), 'SMTP 대화에 애플리케이션 비밀번호 원문이 있습니다.')
  await rejectsMail(() => sendSmtpMail({
    host: '127.0.0.1',
    port: 1,
    secure: false,
    user: 'memo-user',
    pass: 'app-secret',
    from: 'memo-user@naver.com',
  }, {
    to: 'person@example.com',
    subject: '로그인 보안코드',
    text: '코드',
  }))
}

async function rejectsMail(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    if (error instanceof MailDeliveryError && !error.message.includes('app-secret')) {
      return
    }
    throw error
  }
  throw new Error('실패해야 할 메일 전송이 통과했습니다.')
}

async function assertOutboxDelivery(): Promise<void> {
  process.env.MAIL_OUTBOX = '1'
  await deliverSecurityCodeEmail({ to: 'outbox-check@example.com', purpose: 'login', code: '01234567' })
  const outbox = readFileSync(join(root, '.data', 'mail-outbox.jsonl'), 'utf8')
  const line = outbox.trim().split('\n').find((entry) => entry.includes('outbox-check@example.com'))
  assert(line, '아웃박스에 메일이 없습니다.')
  const message = JSON.parse(line) as { to?: string, code?: string, text?: string }
  assert(message.to === 'outbox-check@example.com', '아웃박스 수신자가 다릅니다.')
  assert(message.code === '01234567', '아웃박스에 보안코드가 없습니다.')
  assert(message.text?.includes('01234567'), '아웃박스 본문에 보안코드가 없습니다.')
}

function assertGrantCookie(): void {
  const options = passwordChangeCookieOptions(true)
  assert(options.httpOnly === true, '비밀번호 변경 쿠키가 httpOnly가 아닙니다.')
  assert(options.secure === true, 'HTTPS 쿠키에 Secure가 없습니다.')
  assert(options.maxAge === SECURITY_CODE_TTL_MS / 1000, '쿠키 유지 시간이 보안코드 제한 시간과 다릅니다.')
  const request = new IncomingMessage(new Socket())
  const response = new ServerResponse(request)
  const event = createEvent(request, response)
  applySessionCookie(event, 'session-token')
  applyPasswordChangeCookie(event, 'grant-token')
  const header = response.getHeader('set-cookie')
  const cookies = Array.isArray(header) ? header.map(String) : [String(header ?? '')]
  const session = cookies.find((cookie) => cookie.startsWith('session='))
  const grant = cookies.find((cookie) => cookie.startsWith('password_change='))
  assert(session?.includes('session-token'), '기존 세션 쿠키가 유지되지 않습니다.')
  assert(grant?.includes('grant-token'), '비밀번호 변경 쿠키가 없습니다.')
  assert(session !== undefined && /HttpOnly/i.test(session), '세션 쿠키에 HttpOnly가 없습니다.')
  assert(grant !== undefined && /HttpOnly/i.test(grant), '비밀번호 변경 쿠키에 HttpOnly가 없습니다.')
}

async function verifyCodes(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'web-memo-code-'))
  const db = createClient({ url: `file:${join(dir, 'verify.db').replaceAll('\\', '/')}` })
  try {
    await ensureSchema(db)
    const account = await insertAccount(db, { email: 'code@example.com', password: 'first-password' })
    const other = await insertAccount(db, { email: 'other-code@example.com', password: 'other-password' })
    const started = Date.now()
    const login = await issueSecurityCode(db, { accountId: account.id, purpose: 'login' })
    const loginTtl = Date.parse(login.expiresAt) - started
    assert(/^\d{8}$/.test(login.code), '로그인 코드가 숫자 8자리가 아닙니다.')
    assert(loginTtl <= SECURITY_CODE_TTL_MS && loginTtl > SECURITY_CODE_TTL_MS - 30_000, '로그인 코드 제한 시간이 다릅니다.')
    const change = await issueSecurityCode(db, { accountId: account.id, purpose: 'password_change' })
    assert(/^\d{8}$/.test(change.code), '비밀번호 변경 코드가 숫자 8자리가 아닙니다.')

    const replaced = await issueSecurityCode(db, { accountId: account.id, purpose: 'login' })
    assert(!(await consumeSecurityCode(db, {
      accountId: account.id,
      purpose: 'login',
      code: login.code,
    })), '다시 받은 로그인 코드의 이전 코드가 통과했습니다.')
    assert(!(await consumeSecurityCode(db, {
      accountId: account.id,
      purpose: 'password_change',
      code: replaced.code,
    })), '로그인 코드가 비밀번호 변경에 통과했습니다.')
    assert(await consumeSecurityCode(db, {
      accountId: account.id,
      purpose: 'login',
      code: replaced.code,
    }), '맞는 로그인 코드가 거절되었습니다.')
    assert(!(await consumeSecurityCode(db, {
      accountId: account.id,
      purpose: 'login',
      code: replaced.code,
    })), '사용한 로그인 코드가 다시 통과했습니다.')

    const nowMs = 1_700_000_000_000
    const fresh = await issueSecurityCode(db, {
      accountId: account.id,
      purpose: 'login',
      nowMs,
      ttlMs: 1_000,
    })
    assert(!(await consumeSecurityCode(db, {
      accountId: account.id,
      purpose: 'login',
      code: fresh.code,
      nowMs: nowMs + 1_000,
    })), '만료된 코드가 통과했습니다.')
    const alive = await issueSecurityCode(db, {
      accountId: account.id,
      purpose: 'login',
      nowMs,
      ttlMs: 1_000,
    })
    assert(await consumeSecurityCode(db, {
      accountId: account.id,
      purpose: 'login',
      code: alive.code,
      nowMs: nowMs + 999,
    }), '제한 시간 안의 코드가 거절되었습니다.')

    assert(!(await consumeSecurityCode(db, {
      accountId: other.id,
      purpose: 'password_change',
      code: change.code,
    })), '다른 계정의 코드가 통과했습니다.')
    assert(!(await consumeSecurityCode(db, {
      accountId: account.id,
      purpose: 'login',
      code: change.code,
    })), '비밀번호 변경 코드가 로그인에 통과했습니다.')
    assert(await consumeSecurityCode(db, {
      accountId: account.id,
      purpose: 'password_change',
      code: change.code,
    }), '맞는 비밀번호 변경 코드가 거절되었습니다.')

    const before = await findAccountByEmail(db, 'code@example.com')
    const sessionsBefore = await count(db, 'SELECT count(*) AS n FROM sessions')
    const token = createSessionToken()
    await replacePasswordChangeGrant(db, {
      tokenHash: hashSessionToken(token),
      accountId: account.id,
      expiresAt: new Date(Date.now() + SECURITY_CODE_TTL_MS).toISOString(),
    })
    const grant = await findPasswordChangeGrant(db, hashSessionToken(token))
    assert(grant?.accountId === account.id, '비밀번호 변경 인증을 저장하지 못했습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM sessions') === sessionsBefore, '비밀번호 변경 인증이 세션을 만들었습니다.')
    const grantRow = await db.execute('SELECT token_hash FROM password_change_grants')
    assert(!JSON.stringify(grantRow.rows).includes(token), '비밀번호 변경 쿠키 값이 저장되었습니다.')

    await updateAccountPassword(db, account.id, 'second-password')
    const after = await findAccountByEmail(db, 'code@example.com')
    assert(before?.passwordHash !== after?.passwordHash, '비밀번호 해시가 바뀌지 않았습니다.')
    assert(after !== null && !after.passwordHash.includes('second-password'), '새 비밀번호 원문이 저장되었습니다.')
    assert(after !== null && !(await verifyPassword('first-password', after.passwordHash)), '이전 비밀번호가 통과했습니다.')
    assert(after !== null && await verifyPassword('second-password', after.passwordHash), '새 비밀번호가 통과하지 않았습니다.')
    const unchanged = after?.passwordHash
    await rejectsWith(
      () => updateAccountPassword(db, account.id, ''),
      '비밀번호가 필요합니다.',
    )
    const still = await findAccountByEmail(db, 'code@example.com')
    assert(still?.passwordHash === unchanged, '빈 비밀번호가 해시를 바꿨습니다.')
    assert(await hashPassword('second-password') !== still?.passwordHash, '검증용 해시가 저장 해시와 같습니다.')
  } finally {
    db.close()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }
}

function sliceFunction(source: string, signature: string): string {
  const start = source.indexOf(signature)
  assert(start >= 0, `${signature} 함수가 없습니다.`)
  const next = source.indexOf('\nexport async function ', start + signature.length)
  return source.slice(start, next === -1 ? source.length : next)
}

async function count(db: Client, sql: string): Promise<number> {
  const result = await db.execute(sql)
  return Number(result.rows[0]?.n)
}

async function rejectsWith(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    if (error instanceof StorageError && error.message === message) {
      return
    }
    throw error
  }
  throw new Error(`거절 메시지가 필요합니다: ${message}`)
}

function walk(dir: string, files: string[] = []): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return files
  }
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.nuxt' || entry === '.output' || entry === '.data') {
      continue
    }
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      walk(path, files)
    } else {
      files.push(path)
    }
  }
  return files
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
