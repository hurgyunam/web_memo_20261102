import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { SECURITY_CODE_TTL_MS } from '../db/security-code'
import type { SecurityCodePurpose } from '../db/records'
import { resolveSmtpSettings, sendSmtpMail } from './smtp'

export type SecurityCodeMail = {
  to: string
  purpose: SecurityCodePurpose
  code: string
}

export function renderSecurityCodeMail(input: SecurityCodeMail): { subject: string, text: string } {
  const minutes = SECURITY_CODE_TTL_MS / 60_000
  const subject = input.purpose === 'login' ? '로그인 보안코드' : '비밀번호 변경 보안코드'
  return {
    subject,
    text: [
      `보안코드는 ${input.code} 입니다.`,
      `${minutes}분 안에 입력해 주세요.`,
    ].join('\n'),
  }
}

export function mailCanDeliver(): boolean {
  if (readEnv('SMTP_HOST') && readEnv('SMTP_USER') && readEnv('SMTP_PASS')) {
    return true
  }
  if (readEnv('RESEND_API_KEY') && readEnv('MAIL_FROM')) {
    return true
  }
  return import.meta.dev || readEnv('MAIL_OUTBOX') === '1'
}

export async function deliverSecurityCodeEmail(input: SecurityCodeMail): Promise<void> {
  const message = renderSecurityCodeMail(input)
  const smtp = resolveSmtpSettings()
  if (smtp) {
    await sendSmtpMail(smtp, {
      to: input.to,
      subject: message.subject,
      text: message.text,
    })
    return
  }
  const apiKey = readEnv('RESEND_API_KEY')
  const from = readEnv('MAIL_FROM')
  if (apiKey && from) {
    await sendWithResend({
      apiKey,
      from,
      to: input.to,
      subject: message.subject,
      text: message.text,
    })
    return
  }
  if (import.meta.dev || readEnv('MAIL_OUTBOX') === '1') {
    await writeOutbox({
      to: input.to,
      purpose: input.purpose,
      code: input.code,
      subject: message.subject,
      text: message.text,
    })
    return
  }
  throw new Error('메일 전송 설정이 없습니다.')
}

async function sendWithResend(input: {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
}): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
    }),
  })
  if (!response.ok) {
    throw new Error('메일 전송에 실패했습니다.')
  }
}

async function writeOutbox(entry: {
  to: string
  purpose: SecurityCodePurpose
  code: string
  subject: string
  text: string
}): Promise<void> {
  const directory = join(process.cwd(), '.data')
  await mkdir(directory, { recursive: true })
  await appendFile(join(directory, 'mail-outbox.jsonl'), `${JSON.stringify({
    ...entry,
    sentAt: new Date().toISOString(),
  })}\n`, 'utf8')
}

function readEnv(name: string): string {
  const value = globalThis.process?.env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}
