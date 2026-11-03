import { randomUUID } from 'node:crypto'
import { LibsqlError, type Client } from '@libsql/client'
import { hashPassword } from './passwords'
import { ensureSchema } from './schema'

export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

export type SecurityCodePurpose = 'login' | 'password_change'

export type AccountRecord = {
  id: string
  email: string
  passwordHash: string
}

export type MemoRecord = {
  id: string
  accountId: string
  body: string
  version: number
}

export type SavedFilterRecord = {
  id: string
  accountId: string
  name: string
  includeTagIds: string[]
  excludeTagIds: string[]
  keyword: string
}

export async function insertAccount(
  db: Client,
  input: { email: string, password: string },
): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase()
  if (!email) {
    throw new StorageError('이메일이 필요합니다.')
  }
  if (input.password.length === 0) {
    throw new StorageError('비밀번호가 필요합니다.')
  }
  await ensureSchema(db)
  const id = randomUUID()
  const passwordHash = await hashPassword(input.password)
  await run(
    () => db.execute({
      sql: `INSERT INTO accounts (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`,
      args: [id, email, passwordHash, now()],
    }),
    (detail) => detail.includes('accounts') && detail.includes('UNIQUE')
      ? '이미 가입된 이메일입니다.'
      : undefined,
  )
  return { id }
}

export async function findAccountByEmail(db: Client, email: string): Promise<AccountRecord | null> {
  await ensureSchema(db)
  const result = await db.execute({
    sql: `SELECT id, email, password_hash FROM accounts WHERE email = ?`,
    args: [email.trim().toLowerCase()],
  })
  const row = result.rows[0]
  if (!row) {
    return null
  }
  return {
    id: text(row.id),
    email: text(row.email),
    passwordHash: text(row.password_hash),
  }
}

export async function findAccountEmailById(db: Client, id: string): Promise<string | null> {
  await ensureSchema(db)
  const result = await db.execute({
    sql: `SELECT email FROM accounts WHERE id = ?`,
    args: [id],
  })
  const row = result.rows[0]
  if (!row) {
    return null
  }
  return text(row.email)
}

export async function insertSession(
  db: Client,
  input: { tokenHash: string, accountId: string, expiresAt: string },
): Promise<void> {
  await ensureSchema(db)
  await db.execute({
    sql: `INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    args: [input.tokenHash, input.accountId, input.expiresAt, now()],
  })
}

export async function deleteSession(db: Client, tokenHash: string): Promise<void> {
  await ensureSchema(db)
  await db.execute({
    sql: `DELETE FROM sessions WHERE token_hash = ?`,
    args: [tokenHash],
  })
}

export async function findSessionAccountId(db: Client, tokenHash: string): Promise<string | null> {
  await ensureSchema(db)
  const result = await db.execute({
    sql: `SELECT account_id, expires_at FROM sessions WHERE token_hash = ?`,
    args: [tokenHash],
  })
  const row = result.rows[0]
  if (!row) {
    return null
  }
  const expiresAt = Date.parse(text(row.expires_at))
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    await deleteSession(db, tokenHash)
    return null
  }
  return text(row.account_id)
}

export async function insertSecurityCode(
  db: Client,
  input: {
    accountId: string
    code: string
    purpose: SecurityCodePurpose
    expiresAt: string
  },
): Promise<{ id: string }> {
  if (!/^\d{8}$/.test(input.code)) {
    throw new StorageError('보안코드는 숫자 8자리여야 합니다.')
  }
  if (input.purpose !== 'login' && input.purpose !== 'password_change') {
    throw new StorageError('보안코드 목적이 올바르지 않습니다.')
  }
  if (Number.isNaN(Date.parse(input.expiresAt))) {
    throw new StorageError('보안코드 만료 시각이 올바르지 않습니다.')
  }
  await ensureSchema(db)
  const id = randomUUID()
  await db.execute({
    sql: `INSERT INTO security_codes (id, account_id, code, purpose, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, input.accountId, input.code, input.purpose, input.expiresAt, now()],
  })
  return { id }
}

export async function insertMemo(
  db: Client,
  input: { accountId: string, body: string, version?: number },
): Promise<{ id: string, version: number }> {
  const version = input.version ?? 1
  if (!Number.isInteger(version) || version < 1) {
    throw new StorageError('저장 버전은 1 이상의 정수여야 합니다.')
  }
  await ensureSchema(db)
  const id = randomUUID()
  const timestamp = now()
  await db.execute({
    sql: `INSERT INTO memos (id, account_id, body, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, input.accountId, input.body, version, timestamp, timestamp],
  })
  return { id, version }
}

export async function getMemo(db: Client, id: string): Promise<MemoRecord | null> {
  await ensureSchema(db)
  const result = await db.execute({
    sql: `SELECT id, account_id, body, version FROM memos WHERE id = ?`,
    args: [id],
  })
  const row = result.rows[0]
  if (!row) {
    return null
  }
  return {
    id: text(row.id),
    accountId: text(row.account_id),
    body: text(row.body),
    version: integer(row.version),
  }
}

export async function insertTag(
  db: Client,
  input: { accountId: string, name: string },
): Promise<{ id: string }> {
  const name = input.name.trim()
  if (!name) {
    throw new StorageError('태그 이름이 필요합니다.')
  }
  await ensureSchema(db)
  const id = randomUUID()
  const timestamp = now()
  await run(
    () => db.execute({
      sql: `INSERT INTO tags (id, account_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, input.accountId, name, timestamp, timestamp],
    }),
    (detail) => detail.includes('tags') && detail.includes('UNIQUE')
      ? '같은 이름의 태그가 이미 있습니다.'
      : undefined,
  )
  return { id }
}

export async function linkMemoTag(
  db: Client,
  input: { memoId: string, tagId: string },
): Promise<void> {
  await ensureSchema(db)
  await run(
    () => db.execute({
      sql: `INSERT INTO memo_tags (memo_id, tag_id) VALUES (?, ?)`,
      args: [input.memoId, input.tagId],
    }),
    (detail) => {
      if (detail.includes('account mismatch')) {
        return '다른 계정의 태그는 연결할 수 없습니다.'
      }
      if (detail.includes('PRIMARY') || detail.includes('UNIQUE')) {
        return '이미 연결된 태그입니다.'
      }
      return undefined
    },
  )
}

export async function insertSavedFilter(
  db: Client,
  input: {
    accountId: string
    name: string
    includeTagIds: string[]
    excludeTagIds: string[]
    keyword: string
  },
): Promise<{ id: string }> {
  const name = input.name.trim()
  if (!name) {
    throw new StorageError('필터 이름이 필요합니다.')
  }
  if (typeof input.keyword !== 'string') {
    throw new StorageError('키워드는 하나여야 합니다.')
  }
  const includeTagIds = uniqueIds(input.includeTagIds)
  const excludeTagIds = uniqueIds(input.excludeTagIds)
  if (includeTagIds.some((id) => excludeTagIds.includes(id))) {
    throw new StorageError('포함 태그와 제외 태그에 같은 태그가 있습니다.')
  }
  await ensureSchema(db)
  await assertOwnTags(db, input.accountId, [...includeTagIds, ...excludeTagIds])
  const id = randomUUID()
  await run(
    () => db.batch([
      {
        sql: `INSERT INTO saved_filters (id, account_id, name, keyword, created_at) VALUES (?, ?, ?, ?, ?)`,
        args: [id, input.accountId, name, input.keyword, now()],
      },
      ...includeTagIds.map((tagId, position) => ({
        sql: `INSERT INTO saved_filter_tags (filter_id, tag_id, kind, position) VALUES (?, ?, 'include', ?)`,
        args: [id, tagId, position],
      })),
      ...excludeTagIds.map((tagId, position) => ({
        sql: `INSERT INTO saved_filter_tags (filter_id, tag_id, kind, position) VALUES (?, ?, 'exclude', ?)`,
        args: [id, tagId, position],
      })),
    ], 'write'),
    (detail) => {
      if (detail.includes('saved_filters') && detail.includes('UNIQUE')) {
        return '같은 이름의 필터가 이미 있습니다.'
      }
      if (detail.includes('account mismatch')) {
        return '다른 계정의 태그는 필터에 넣을 수 없습니다.'
      }
      return undefined
    },
  )
  return { id }
}

export async function getSavedFilter(db: Client, id: string): Promise<SavedFilterRecord | null> {
  await ensureSchema(db)
  const filter = await db.execute({
    sql: `SELECT id, account_id, name, keyword FROM saved_filters WHERE id = ?`,
    args: [id],
  })
  const row = filter.rows[0]
  if (!row) {
    return null
  }
  const tags = await db.execute({
    sql: `SELECT tag_id, kind FROM saved_filter_tags WHERE filter_id = ? ORDER BY kind, position`,
    args: [id],
  })
  const includeTagIds: string[] = []
  const excludeTagIds: string[] = []
  for (const tagRow of tags.rows) {
    const tagId = text(tagRow.tag_id)
    const kind = text(tagRow.kind)
    if (kind === 'include') {
      includeTagIds.push(tagId)
    } else if (kind === 'exclude') {
      excludeTagIds.push(tagId)
    }
  }
  return {
    id: text(row.id),
    accountId: text(row.account_id),
    name: text(row.name),
    keyword: text(row.keyword),
    includeTagIds,
    excludeTagIds,
  }
}

async function assertOwnTags(db: Client, accountId: string, tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) {
    return
  }
  const placeholders = tagIds.map(() => '?').join(', ')
  const result = await db.execute({
    sql: `SELECT id FROM tags WHERE account_id = ? AND id IN (${placeholders})`,
    args: [accountId, ...tagIds],
  })
  if (result.rows.length !== tagIds.length) {
    throw new StorageError('이 계정의 태그만 필터에 넣을 수 있습니다.')
  }
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    result.push(id)
  }
  return result
}

async function run(action: () => Promise<unknown>, map: (detail: string) => string | undefined): Promise<void> {
  try {
    await action()
  } catch (error) {
    const message = map(constraintDetail(error))
    if (message) {
      throw new StorageError(message)
    }
    throw error
  }
}

function constraintDetail(error: unknown): string {
  if (error instanceof LibsqlError) {
    return `${error.extendedCode ?? ''} ${error.message}`
  }
  if (error instanceof Error) {
    return error.message
  }
  return ''
}

function text(value: unknown): string {
  if (typeof value !== 'string') {
    throw new StorageError('저장된 값이 올바르지 않습니다.')
  }
  return value
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new StorageError('저장된 값이 올바르지 않습니다.')
  }
  return value
}

function now(): string {
  return new Date().toISOString()
}
