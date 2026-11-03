import { randomBytes } from 'node:crypto'
import { readBody, type H3Event } from 'h3'
import {
  applyPasswordChangeCookie,
  clearPasswordChangeCookie,
  readPasswordChangeToken,
} from '../db/password-change-cookie'
import { hashPassword, verifyPassword } from '../db/passwords'
import {
  deletePasswordChangeGrant,
  deleteSecurityCodeById,
  findAccountByEmail,
  findAccountEmailById,
  findPasswordChangeGrant,
  insertAccount,
  replacePasswordChangeGrant,
  updateAccountPassword,
  type SecurityCodePurpose,
  StorageError,
} from '../db/records'
import { consumeSecurityCode, issueSecurityCode, SECURITY_CODE_TTL_MS } from '../db/security-code'
import { createSessionToken, hashSessionToken } from '../db/session-cookie'
import { getDb } from './db'
import { deliverSecurityCodeEmail, mailCanDeliver } from './mail'
import { MailDeliveryError } from './smtp'
import { closeSession, getSessionAccountId, openSession } from './session'

export class AccountActionError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'AccountActionError'
    this.statusCode = statusCode
  }
}

export async function registerAccount(event: H3Event): Promise<{ ok: true }> {
  const { email, password } = await readCredentials(event)
  const normalized = normalizeSignupEmail(email)
  assertSignupPassword(password)
  const db = await getDb()
  if (await findAccountByEmail(db, normalized)) {
    throw new AccountActionError(409, '이미 가입된 이메일입니다.')
  }
  try {
    await insertAccount(db, { email: normalized, password })
  } catch (error) {
    if (error instanceof StorageError && error.message === '이미 가입된 이메일입니다.') {
      throw new AccountActionError(409, error.message)
    }
    if (error instanceof StorageError && (error.message === '이메일이 필요합니다.' || error.message === '비밀번호가 필요합니다.')) {
      throw new AccountActionError(400, `입력 오류: ${error.message}`)
    }
    throw error
  }
  return { ok: true }
}

export async function signInAccount(event: H3Event): Promise<{ ok: true }> {
  const { email, password } = await readCredentials(event)
  const account = await findAccountByEmail(await getDb(), email)
  const matched = account
    ? await verifyPassword(password, account.passwordHash)
    : await verifyPassword(password, await hashForMissingAccount())
  if (!account || !matched) {
    throw new AccountActionError(401, '로그인 실패: 이메일 또는 비밀번호가 올바르지 않습니다.')
  }
  await openSession(event, account.id)
  return { ok: true }
}

export async function signOutAccount(event: H3Event): Promise<{ ok: true }> {
  await closeSession(event)
  return { ok: true }
}

export async function readAccountSession(event: H3Event): Promise<{ email: string | null }> {
  const accountId = await getSessionAccountId(event)
  if (!accountId) {
    return { email: null }
  }
  return {
    email: await findAccountEmailById(await getDb(), accountId),
  }
}

export async function requestSecurityCode(event: H3Event): Promise<{ ok: true }> {
  const record = await readRecord(event)
  const purpose = readPurpose(record.purpose)
  const normalized = normalizeSignupEmail(typeof record.email === 'string' ? record.email : '')
  const db = await getDb()
  const account = await findAccountByEmail(db, normalized)
  if (!account) {
    throw new AccountActionError(404, '실패: 가입된 이메일이 아닙니다.')
  }
  if (!mailCanDeliver()) {
    throw new AccountActionError(500, '보안코드를 보내지 못했습니다.')
  }
  const issued = await issueSecurityCode(db, { accountId: account.id, purpose })
  try {
    await deliverSecurityCodeEmail({ to: account.email, purpose, code: issued.code })
  } catch (error) {
    await deleteSecurityCodeById(db, issued.id)
    if (error instanceof MailDeliveryError) {
      throw new AccountActionError(500, error.message)
    }
    throw new AccountActionError(500, '보안코드를 보내지 못했습니다.')
  }
  return { ok: true }
}

export async function signInWithSecurityCode(event: H3Event): Promise<{ ok: true }> {
  const accountId = await requireMatchingCode(event, 'login')
  await openSession(event, accountId)
  return { ok: true }
}

export async function acceptChangeCode(event: H3Event): Promise<{ ok: true }> {
  const accountId = await requireMatchingCode(event, 'password_change')
  const token = createSessionToken()
  const expiresAt = new Date(Date.now() + SECURITY_CODE_TTL_MS).toISOString()
  await replacePasswordChangeGrant(await getDb(), {
    tokenHash: hashSessionToken(token),
    accountId,
    expiresAt,
  })
  applyPasswordChangeCookie(event, token)
  return { ok: true }
}

export async function readChangeReady(event: H3Event): Promise<{ ready: boolean }> {
  const grant = await currentChangeGrant(event)
  return { ready: grant !== null }
}

export async function saveNewSecret(event: H3Event): Promise<{ ok: true }> {
  const record = await readRecord(event)
  const password = typeof record.password === 'string' ? record.password : ''
  if (password.length === 0) {
    throw new AccountActionError(400, '입력 오류: 비밀번호를 입력해 주세요.')
  }
  const grant = await currentChangeGrant(event)
  if (!grant) {
    throw new AccountActionError(401, '인증 실패')
  }
  try {
    await updateAccountPassword(await getDb(), grant.accountId, password)
  } catch (error) {
    if (error instanceof StorageError && error.message === '비밀번호가 필요합니다.') {
      throw new AccountActionError(400, '입력 오류: 비밀번호를 입력해 주세요.')
    }
    throw error
  }
  await deletePasswordChangeGrant(await getDb(), grant.tokenHash)
  clearPasswordChangeCookie(event)
  return { ok: true }
}

function normalizeSignupEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (!normalized) {
    throw new AccountActionError(400, '입력 오류: 이메일을 입력해 주세요.')
  }
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AccountActionError(400, '입력 오류: 이메일 형식이 아닙니다.')
  }
  return normalized
}

function assertSignupPassword(password: string): void {
  if (password.length === 0) {
    throw new AccountActionError(400, '입력 오류: 비밀번호를 입력해 주세요.')
  }
}

async function requireMatchingCode(event: H3Event, purpose: SecurityCodePurpose): Promise<string> {
  const record = await readRecord(event)
  const email = typeof record.email === 'string' ? record.email : ''
  const code = typeof record.code === 'string' ? record.code : ''
  const account = await findAccountByEmail(await getDb(), email)
  const matched = account
    ? await consumeSecurityCode(await getDb(), {
        accountId: account.id,
        purpose,
        code,
      })
    : false
  if (!account || !matched) {
    throw new AccountActionError(401, '인증 실패')
  }
  return account.id
}

async function currentChangeGrant(event: H3Event): Promise<{ tokenHash: string, accountId: string } | null> {
  const token = readPasswordChangeToken(event)
  if (!token) {
    return null
  }
  const tokenHash = hashSessionToken(token)
  const grant = await findPasswordChangeGrant(await getDb(), tokenHash)
  const expired = !grant || grant.expiresAt <= new Date().toISOString()
  if (!grant || expired) {
    if (grant) {
      await deletePasswordChangeGrant(await getDb(), tokenHash)
    }
    clearPasswordChangeCookie(event)
    return null
  }
  return { tokenHash, accountId: grant.accountId }
}

function readPurpose(value: unknown): SecurityCodePurpose {
  if (value === 'login' || value === 'password_change') {
    return value
  }
  throw new AccountActionError(400, '입력 오류: 보안코드 요청이 올바르지 않습니다.')
}

async function readRecord(event: H3Event): Promise<Record<string, unknown>> {
  const body = await readBody(event)
  return body && typeof body === 'object' ? body as Record<string, unknown> : {}
}

async function readCredentials(event: H3Event): Promise<{ email: string, password: string }> {
  const record = await readRecord(event)
  return {
    email: typeof record.email === 'string' ? record.email : '',
    password: typeof record.password === 'string' ? record.password : '',
  }
}

let placeholderHash: Promise<string> | undefined

function hashForMissingAccount(): Promise<string> {
  if (!placeholderHash) {
    placeholderHash = hashPassword(randomBytes(32).toString('base64url')).catch((error: unknown) => {
      placeholderHash = undefined
      throw error
    })
  }
  return placeholderHash
}
