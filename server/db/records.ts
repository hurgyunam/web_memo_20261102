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
  updatedAt: string
}

export type MemoCommitRecord = {
  id: string
  memoId: string
  body: string
  seq: number
  createdAt: string
}

export type MemoCommitOutcome =
  | { kind: 'created', commit: MemoCommitRecord }
  | { kind: 'unchanged', commit: MemoCommitRecord }
  | { kind: 'missing' }
  | { kind: 'conflict' }

export type TagRecord = {
  id: string
  accountId: string
  name: string
}

export type TagRenameOutcome =
  | { kind: 'renamed', tag: TagRecord }
  | { kind: 'missing' }

export type SavedFilterRecord = {
  id: string
  accountId: string
  name: string
  includeTagIds: string[]
  excludeTagIds: string[]
  keyword: string
}

export type FilteredMemos = {
  memos: MemoRecord[]
  includeTags: TagRecord[]
  excludeTags: TagRecord[]
  keyword: string
}

export type SavedFilterView = {
  id: string
  accountId: string
  name: string
  keyword: string
  includeTags: TagRecord[]
  excludeTags: TagRecord[]
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

export async function listSecurityCodes(
  db: Client,
  input: { accountId: string, purpose: SecurityCodePurpose },
): Promise<Array<{ id: string, code: string, expiresAt: string }>> {
  await ensureSchema(db)
  const result = await db.execute({
    sql: `SELECT id, code, expires_at FROM security_codes
          WHERE account_id = ? AND purpose = ?
          ORDER BY created_at DESC`,
    args: [input.accountId, input.purpose],
  })
  return result.rows.map((row) => ({
    id: text(row.id),
    code: text(row.code),
    expiresAt: text(row.expires_at),
  }))
}

export async function deleteSecurityCodes(
  db: Client,
  input: { accountId: string, purpose: SecurityCodePurpose },
): Promise<void> {
  await ensureSchema(db)
  await db.execute({
    sql: `DELETE FROM security_codes WHERE account_id = ? AND purpose = ?`,
    args: [input.accountId, input.purpose],
  })
}

export async function deleteSecurityCodeById(db: Client, id: string): Promise<boolean> {
  await ensureSchema(db)
  const result = await db.execute({
    sql: `DELETE FROM security_codes WHERE id = ?`,
    args: [id],
  })
  return Number(result.rowsAffected) > 0
}

export async function deleteExpiredSecurityCodes(
  db: Client,
  input: { accountId: string, purpose: SecurityCodePurpose, nowIso: string },
): Promise<void> {
  await ensureSchema(db)
  await db.execute({
    sql: `DELETE FROM security_codes WHERE account_id = ? AND purpose = ? AND expires_at <= ?`,
    args: [input.accountId, input.purpose, input.nowIso],
  })
}

export async function updateAccountPassword(db: Client, accountId: string, password: string): Promise<void> {
  if (password.length === 0) {
    throw new StorageError('비밀번호가 필요합니다.')
  }
  await ensureSchema(db)
  const passwordHash = await hashPassword(password)
  const result = await db.execute({
    sql: `UPDATE accounts SET password_hash = ? WHERE id = ?`,
    args: [passwordHash, accountId],
  })
  if (Number(result.rowsAffected) !== 1) {
    throw new StorageError('계정을 찾지 못했습니다.')
  }
}

export async function replacePasswordChangeGrant(
  db: Client,
  input: { tokenHash: string, accountId: string, expiresAt: string },
): Promise<void> {
  if (Number.isNaN(Date.parse(input.expiresAt))) {
    throw new StorageError('비밀번호 변경 인증 만료 시각이 올바르지 않습니다.')
  }
  await ensureSchema(db)
  await db.batch([
    {
      sql: `DELETE FROM password_change_grants WHERE account_id = ?`,
      args: [input.accountId],
    },
    {
      sql: `INSERT INTO password_change_grants (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
      args: [input.tokenHash, input.accountId, input.expiresAt, now()],
    },
  ], 'write')
}

export async function findPasswordChangeGrant(
  db: Client,
  tokenHash: string,
): Promise<{ accountId: string, expiresAt: string } | null> {
  await ensureSchema(db)
  const result = await db.execute({
    sql: `SELECT account_id, expires_at FROM password_change_grants WHERE token_hash = ?`,
    args: [tokenHash],
  })
  const row = result.rows[0]
  if (!row) {
    return null
  }
  return {
    accountId: text(row.account_id),
    expiresAt: text(row.expires_at),
  }
}

export async function deletePasswordChangeGrant(db: Client, tokenHash: string): Promise<void> {
  await ensureSchema(db)
  await db.execute({
    sql: `DELETE FROM password_change_grants WHERE token_hash = ?`,
    args: [tokenHash],
  })
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
    sql: `SELECT id, account_id, body, version, updated_at FROM memos WHERE id = ?`,
    args: [id],
  })
  const row = result.rows[0]
  return row ? mapMemo(row) : null
}

export async function listMemosForAccount(db: Client, accountId: string): Promise<MemoRecord[]> {
  await ensureSchema(db)
  const result = await db.execute({
    sql: `SELECT id, account_id, body, version, updated_at
          FROM memos
          WHERE account_id = ?
          ORDER BY updated_at DESC, id DESC`,
    args: [accountId],
  })
  return result.rows.map((row) => mapMemo(row))
}

export async function getMemoForAccount(db: Client, accountId: string, id: string): Promise<MemoRecord | null> {
  await ensureSchema(db)
  const result = await db.execute({
    sql: `SELECT id, account_id, body, version, updated_at
          FROM memos
          WHERE id = ? AND account_id = ?`,
    args: [id, accountId],
  })
  const row = result.rows[0]
  return row ? mapMemo(row) : null
}

export async function deleteMemoForAccount(
  db: Client,
  input: { accountId: string, id: string },
): Promise<boolean> {
  await ensureSchema(db)
  const existing = await db.execute({
    sql: `SELECT id FROM memos WHERE id = ? AND account_id = ?`,
    args: [input.id, input.accountId],
  })
  if (!existing.rows[0]) {
    return false
  }
  await db.batch([
    {
      sql: `DELETE FROM memo_tags WHERE memo_id = ?`,
      args: [input.id],
    },
    {
      sql: `DELETE FROM memo_commits WHERE memo_id = ?`,
      args: [input.id],
    },
    {
      sql: `DELETE FROM memos WHERE id = ? AND account_id = ?`,
      args: [input.id, input.accountId],
    },
  ], 'write')
  return true
}

export type MemoSaveOutcome =
  | { kind: 'saved', memo: MemoRecord }
  | { kind: 'missing' }
  | { kind: 'conflict' }

export async function saveMemoIfCurrentVersion(
  db: Client,
  input: { accountId: string, id: string, body: string, baseVersion: number },
): Promise<MemoSaveOutcome> {
  if (!Number.isInteger(input.baseVersion) || input.baseVersion < 1) {
    throw new StorageError('저장 버전이 올바르지 않습니다.')
  }
  await ensureSchema(db)
  const timestamp = now()
  const result = await db.execute({
    sql: `UPDATE memos
          SET body = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND account_id = ? AND version = ?`,
    args: [input.body, timestamp, input.id, input.accountId, input.baseVersion],
  })
  if (Number(result.rowsAffected) === 1) {
    return {
      kind: 'saved',
      memo: {
        id: input.id,
        accountId: input.accountId,
        body: input.body,
        version: input.baseVersion + 1,
        updatedAt: timestamp,
      },
    }
  }
  const existing = await getMemoForAccount(db, input.accountId, input.id)
  if (!existing) {
    return { kind: 'missing' }
  }
  return { kind: 'conflict' }
}

export async function listMemoCommitsForAccount(
  db: Client,
  input: { accountId: string, memoId: string },
): Promise<MemoCommitRecord[] | null> {
  await ensureSchema(db)
  const memo = await getMemoForAccount(db, input.accountId, input.memoId)
  if (!memo) {
    return null
  }
  const result = await db.execute({
    sql: `SELECT id, memo_id, body, seq, created_at
          FROM memo_commits
          WHERE memo_id = ?
          ORDER BY seq DESC, id DESC`,
    args: [input.memoId],
  })
  return result.rows.map((row) => mapCommit(row))
}

export async function commitMemoForAccount(
  db: Client,
  input: { accountId: string, memoId: string, body: string, baseVersion: number },
): Promise<MemoCommitOutcome> {
  if (!Number.isInteger(input.baseVersion) || input.baseVersion < 1) {
    throw new StorageError('저장 버전이 올바르지 않습니다.')
  }
  await ensureSchema(db)
  const tx = await db.transaction('write')
  try {
    const memoResult = await tx.execute({
      sql: `SELECT id, account_id, body, version, updated_at
            FROM memos
            WHERE id = ? AND account_id = ?`,
      args: [input.memoId, input.accountId],
    })
    const memoRow = memoResult.rows[0]
    if (!memoRow) {
      return { kind: 'missing' }
    }
    const memo = mapMemo(memoRow)
    if (memo.version !== input.baseVersion || memo.body !== input.body) {
      return { kind: 'conflict' }
    }
    const headResult = await tx.execute({
      sql: `SELECT id, memo_id, body, seq, created_at
            FROM memo_commits
            WHERE memo_id = ?
            ORDER BY seq DESC
            LIMIT 1`,
      args: [input.memoId],
    })
    const head = headResult.rows[0]
    if (head && text(head.body) === memo.body) {
      return { kind: 'unchanged', commit: mapCommit(head) }
    }
    const seqResult = await tx.execute({
      sql: `SELECT COALESCE(MAX(seq), 0) AS seq FROM memo_commits WHERE memo_id = ?`,
      args: [input.memoId],
    })
    const seq = integer(seqResult.rows[0]?.seq) + 1
    const id = randomUUID()
    const createdAt = now()
    await tx.execute({
      sql: `INSERT INTO memo_commits (id, memo_id, body, seq, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, input.memoId, memo.body, seq, createdAt],
    })
    const commit: MemoCommitRecord = {
      id,
      memoId: input.memoId,
      body: memo.body,
      seq,
      createdAt,
    }
    await tx.commit()
    return { kind: 'created', commit }
  } finally {
    tx.close()
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

export async function listTagsForAccount(db: Client, accountId: string): Promise<TagRecord[]> {
  await ensureSchema(db)
  const result = await db.execute({
    sql: `SELECT id, account_id, name
          FROM tags
          WHERE account_id = ?
          ORDER BY name, id`,
    args: [accountId],
  })
  return result.rows.map((row) => mapTag(row))
}

export async function getTagForAccount(db: Client, accountId: string, id: string): Promise<TagRecord | null> {
  await ensureSchema(db)
  const result = await db.execute({
    sql: `SELECT id, account_id, name FROM tags WHERE id = ? AND account_id = ?`,
    args: [id, accountId],
  })
  const row = result.rows[0]
  return row ? mapTag(row) : null
}

export async function renameTagForAccount(
  db: Client,
  input: { accountId: string, id: string, name: string },
): Promise<TagRenameOutcome> {
  const name = input.name.trim()
  if (!name) {
    throw new StorageError('태그 이름이 필요합니다.')
  }
  await ensureSchema(db)
  const result = await run(
    () => db.execute({
      sql: `UPDATE tags SET name = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
      args: [name, now(), input.id, input.accountId],
    }),
    (detail) => detail.includes('tags') && detail.includes('UNIQUE')
      ? '같은 이름의 태그가 이미 있습니다.'
      : undefined,
  )
  if (Number(result.rowsAffected) !== 1) {
    return { kind: 'missing' }
  }
  return {
    kind: 'renamed',
    tag: {
      id: input.id,
      accountId: input.accountId,
      name,
    },
  }
}

export async function deleteTagForAccount(
  db: Client,
  input: { accountId: string, id: string },
): Promise<boolean> {
  await ensureSchema(db)
  const existing = await db.execute({
    sql: `SELECT id FROM tags WHERE id = ? AND account_id = ?`,
    args: [input.id, input.accountId],
  })
  if (!existing.rows[0]) {
    return false
  }
  await db.batch([
    {
      sql: `DELETE FROM memo_tags WHERE tag_id = ?`,
      args: [input.id],
    },
    {
      sql: `DELETE FROM saved_filter_tags WHERE tag_id = ?`,
      args: [input.id],
    },
    {
      sql: `DELETE FROM tags WHERE id = ? AND account_id = ?`,
      args: [input.id, input.accountId],
    },
  ], 'write')
  return true
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

export type MemoTagLinkOutcome =
  | { kind: 'linked', tag: TagRecord }
  | { kind: 'missing-memo' }
  | { kind: 'missing-tag' }

export async function linkMemoTagForAccount(
  db: Client,
  input: { accountId: string, memoId: string, tagId: string },
): Promise<MemoTagLinkOutcome> {
  await ensureSchema(db)
  const memo = await getMemoForAccount(db, input.accountId, input.memoId)
  if (!memo) {
    return { kind: 'missing-memo' }
  }
  const tag = await getTagForAccount(db, input.accountId, input.tagId)
  if (!tag) {
    return { kind: 'missing-tag' }
  }
  const existing = await db.execute({
    sql: `SELECT 1 AS ok FROM memo_tags WHERE memo_id = ? AND tag_id = ?`,
    args: [input.memoId, input.tagId],
  })
  if (!existing.rows[0]) {
    try {
      await linkMemoTag(db, { memoId: input.memoId, tagId: input.tagId })
    } catch (error) {
      if (!(error instanceof StorageError) || error.message !== '이미 연결된 태그입니다.') {
        throw error
      }
    }
  }
  const current = await getTagForAccount(db, input.accountId, input.tagId)
  return { kind: 'linked', tag: current ?? tag }
}

export type TagMemoAssignRecord = {
  tag: TagRecord
  memos: Array<MemoRecord & { linked: boolean }>
}

export async function listTagMemoAssign(
  db: Client,
  input: { accountId: string, tagId: string },
): Promise<TagMemoAssignRecord | null> {
  await ensureSchema(db)
  const tag = await getTagForAccount(db, input.accountId, input.tagId)
  if (!tag) {
    return null
  }
  const memos = await listMemosForAccount(db, input.accountId)
  const linked = await db.execute({
    sql: `SELECT memo_tags.memo_id AS id
          FROM memo_tags
          JOIN memos ON memos.id = memo_tags.memo_id
          WHERE memo_tags.tag_id = ? AND memos.account_id = ?`,
    args: [input.tagId, input.accountId],
  })
  const linkedIds = new Set(linked.rows.map((row) => text(row.id)))
  return {
    tag,
    memos: memos.map((memo) => ({ ...memo, linked: linkedIds.has(memo.id) })),
  }
}

export type TagMemoBulkOutcome =
  | { kind: 'linked', tag: TagRecord, memoIds: string[] }
  | { kind: 'missing-tag' }
  | { kind: 'missing-memo' }

export async function linkTagToMemosForAccount(
  db: Client,
  input: { accountId: string, tagId: string, memoIds: string[] },
): Promise<TagMemoBulkOutcome> {
  await ensureSchema(db)
  const tag = await getTagForAccount(db, input.accountId, input.tagId)
  if (!tag) {
    return { kind: 'missing-tag' }
  }
  const memoIds = uniqueIds(input.memoIds)
  for (const memoId of memoIds) {
    const memo = await getMemoForAccount(db, input.accountId, memoId)
    if (!memo) {
      return { kind: 'missing-memo' }
    }
  }
  for (const memoId of memoIds) {
    const outcome = await linkMemoTagForAccount(db, {
      accountId: input.accountId,
      memoId,
      tagId: input.tagId,
    })
    if (outcome.kind !== 'linked') {
      return outcome.kind === 'missing-tag' ? { kind: 'missing-tag' } : { kind: 'missing-memo' }
    }
  }
  const current = await getTagForAccount(db, input.accountId, input.tagId)
  return { kind: 'linked', tag: current ?? tag, memoIds }
}

export async function listTagsForMemo(
  db: Client,
  input: { accountId: string, memoId: string },
): Promise<TagRecord[] | null> {
  await ensureSchema(db)
  const memo = await getMemoForAccount(db, input.accountId, input.memoId)
  if (!memo) {
    return null
  }
  const result = await db.execute({
    sql: `SELECT tags.id, tags.account_id, tags.name
          FROM memo_tags
          JOIN tags ON tags.id = memo_tags.tag_id AND tags.account_id = ?
          WHERE memo_tags.memo_id = ?
          ORDER BY tags.name, tags.id`,
    args: [input.accountId, input.memoId],
  })
  return result.rows.map((row) => mapTag(row))
}

export type MemoTagUnlinkOutcome = 'removed' | 'missing-memo' | 'missing-link'

export async function unlinkMemoTagForAccount(
  db: Client,
  input: { accountId: string, memoId: string, tagId: string },
): Promise<MemoTagUnlinkOutcome> {
  await ensureSchema(db)
  const memo = await getMemoForAccount(db, input.accountId, input.memoId)
  if (!memo) {
    return 'missing-memo'
  }
  const result = await db.execute({
    sql: `DELETE FROM memo_tags WHERE memo_id = ? AND tag_id = ?`,
    args: [input.memoId, input.tagId],
  })
  return Number(result.rowsAffected) === 1 ? 'removed' : 'missing-link'
}

export async function listMemosByFilter(
  db: Client,
  input: {
    accountId: string
    includeTagIds: string[]
    excludeTagIds: string[]
    keyword: string
  },
): Promise<FilteredMemos> {
  if (typeof input.keyword !== 'string') {
    throw new StorageError('키워드는 하나여야 합니다.')
  }
  const includeTagIds = uniqueIds(input.includeTagIds)
  const excludeTagIds = uniqueIds(input.excludeTagIds)
  if (includeTagIds.some((id) => excludeTagIds.includes(id))) {
    throw new StorageError('포함 태그와 제외 태그에 같은 태그가 있습니다.')
  }
  await ensureSchema(db)
  const includeTags = await ownTags(db, input.accountId, includeTagIds)
  const excludeTags = await ownTags(db, input.accountId, excludeTagIds)
  const args: Array<string | number> = [input.accountId]
  let sql = `SELECT memos.id, memos.account_id, memos.body, memos.version, memos.updated_at
             FROM memos
             WHERE memos.account_id = ?`
  if (includeTagIds.length > 0) {
    const placeholders = includeTagIds.map(() => '?').join(', ')
    sql += ` AND (
      SELECT COUNT(DISTINCT memo_tags.tag_id)
      FROM memo_tags
      WHERE memo_tags.memo_id = memos.id AND memo_tags.tag_id IN (${placeholders})
    ) = ?`
    args.push(...includeTagIds, includeTagIds.length)
  }
  if (excludeTagIds.length > 0) {
    const placeholders = excludeTagIds.map(() => '?').join(', ')
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM memo_tags
      WHERE memo_tags.memo_id = memos.id AND memo_tags.tag_id IN (${placeholders})
    )`
    args.push(...excludeTagIds)
  }
  sql += ` ORDER BY memos.updated_at DESC, memos.id DESC`
  const result = await db.execute({ sql, args })
  const keyword = input.keyword
  return {
    memos: result.rows.map((row) => mapMemo(row)).filter((memo) => matchesKeyword(memo.body, keyword)),
    includeTags,
    excludeTags,
    keyword,
  }
}

export async function listSavedFiltersForAccount(db: Client, accountId: string): Promise<SavedFilterView[]> {
  return readFilterViews(db, accountId)
}

export async function getSavedFilterForAccount(
  db: Client,
  accountId: string,
  id: string,
): Promise<SavedFilterView | null> {
  const views = await readFilterViews(db, accountId, id)
  return views[0] ?? null
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
  await ownTags(db, input.accountId, [...includeTagIds, ...excludeTagIds])
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

async function ownTags(db: Client, accountId: string, tagIds: string[]): Promise<TagRecord[]> {
  const ids = uniqueIds(tagIds)
  if (ids.length === 0) {
    return []
  }
  const placeholders = ids.map(() => '?').join(', ')
  const result = await db.execute({
    sql: `SELECT id, account_id, name FROM tags WHERE account_id = ? AND id IN (${placeholders})`,
    args: [accountId, ...ids],
  })
  const byId = new Map(result.rows.map((row) => {
    const tag = mapTag(row)
    return [tag.id, tag] as const
  }))
  if (byId.size !== ids.length) {
    throw new StorageError('이 계정의 태그만 필터에 넣을 수 있습니다.')
  }
  return ids.map((id) => {
    const tag = byId.get(id)
    if (!tag) {
      throw new StorageError('이 계정의 태그만 필터에 넣을 수 있습니다.')
    }
    return tag
  })
}

async function readFilterViews(db: Client, accountId: string, id?: string): Promise<SavedFilterView[]> {
  await ensureSchema(db)
  const args = [accountId]
  let where = `saved_filters.account_id = ?`
  if (id) {
    where += ` AND saved_filters.id = ?`
    args.push(id)
  }
  const result = await db.execute({
    sql: `SELECT saved_filters.id, saved_filters.account_id, saved_filters.name, saved_filters.keyword,
                 saved_filter_tags.tag_id, saved_filter_tags.kind, tags.name AS tag_name
          FROM saved_filters
          LEFT JOIN saved_filter_tags ON saved_filter_tags.filter_id = saved_filters.id
          LEFT JOIN tags ON tags.id = saved_filter_tags.tag_id AND tags.account_id = saved_filters.account_id
          WHERE ${where}
          ORDER BY saved_filters.created_at DESC, saved_filters.id DESC,
                   CASE saved_filter_tags.kind WHEN 'include' THEN 0 WHEN 'exclude' THEN 1 ELSE 2 END,
                   saved_filter_tags.position ASC`,
    args,
  })
  const order: string[] = []
  const views = new Map<string, SavedFilterView>()
  for (const row of result.rows) {
    const filterId = text(row.id)
    let view = views.get(filterId)
    if (!view) {
      view = {
        id: filterId,
        accountId: text(row.account_id),
        name: text(row.name),
        keyword: text(row.keyword),
        includeTags: [],
        excludeTags: [],
      }
      views.set(filterId, view)
      order.push(filterId)
    }
    const tagId = row.tag_id
    const tagName = row.tag_name
    const kind = row.kind
    if (typeof tagId !== 'string' || typeof tagName !== 'string') {
      continue
    }
    const tag: TagRecord = { id: tagId, accountId: view.accountId, name: tagName }
    if (kind === 'include') {
      view.includeTags.push(tag)
    } else if (kind === 'exclude') {
      view.excludeTags.push(tag)
    }
  }
  return order.map((filterId) => {
    const view = views.get(filterId)
    if (!view) {
      throw new StorageError('저장된 값이 올바르지 않습니다.')
    }
    return view
  })
}

function matchesKeyword(body: string, keyword: string): boolean {
  if (keyword.length === 0) {
    return true
  }
  return body.toLowerCase().includes(keyword.toLowerCase())
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

async function run<T>(action: () => Promise<T>, map: (detail: string) => string | undefined): Promise<T> {
  try {
    return await action()
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

function mapTag(row: Record<string, unknown>): TagRecord {
  return {
    id: text(row.id),
    accountId: text(row.account_id),
    name: text(row.name),
  }
}

function mapMemo(row: Record<string, unknown>): MemoRecord {
  return {
    id: text(row.id),
    accountId: text(row.account_id),
    body: text(row.body),
    version: integer(row.version),
    updatedAt: text(row.updated_at),
  }
}

function mapCommit(row: Record<string, unknown>): MemoCommitRecord {
  return {
    id: text(row.id),
    memoId: text(row.memo_id),
    body: text(row.body),
    seq: integer(row.seq),
    createdAt: text(row.created_at),
  }
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
