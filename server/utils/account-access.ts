import { randomBytes } from 'node:crypto'
import { readBody, type H3Event } from 'h3'
import { findAccountByEmail, findAccountEmailById, insertAccount, StorageError } from '../db/records'
import { hashPassword, verifyPassword } from '../db/passwords'
import { getDb } from './db'
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

async function readCredentials(event: H3Event): Promise<{ email: string, password: string }> {
  const body = await readBody(event)
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
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
