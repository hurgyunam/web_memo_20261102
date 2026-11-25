import { getQuery, getRouterParam, readBody, type H3Event } from 'h3'
import type { MemoItem, MemoList } from '../../types/memo'
import { mapFilterError, toFilterTag } from './filter-access'
import {
  deleteMemoForAccount,
  getMemoForAccount,
  getSavedFilterForAccount,
  insertMemo,
  listMemosByFilter,
  listMemosForAccount,
  saveMemoIfCurrentVersion,
  StorageError,
  type MemoRecord,
} from '../db/records'
import { NEW_MEMO_BODY } from '../../utils/new-memo'
import { AccountActionError } from './account-access'
import { getDb } from './db'
import { getSessionAccountId } from './session'

export async function listOwnMemos(event: H3Event): Promise<MemoList> {
  const accountId = await requireAccount(event)
  const db = await getDb()
  const query = getQuery(event)
  try {
    const filterId = readOptionalText(query.filter)
    if (filterId) {
      const saved = await getSavedFilterForAccount(db, accountId, filterId)
      if (!saved) {
        throw new AccountActionError(404, '필터를 찾지 못했습니다.')
      }
      const filtered = await listMemosByFilter(db, {
        accountId,
        includeTagIds: saved.includeTags.map((tag) => tag.id),
        excludeTagIds: saved.excludeTags.map((tag) => tag.id),
        keyword: saved.keyword,
      })
      return {
        memos: filtered.memos.map(toMemoItem),
        applied: {
          id: saved.id,
          name: saved.name,
          keyword: saved.keyword,
          includeTags: saved.includeTags.map(toFilterTag),
          excludeTags: saved.excludeTags.map(toFilterTag),
        },
      }
    }
    const includeTagIds = readTagQuery(query.include)
    const excludeTagIds = readTagQuery(query.exclude)
    const keyword = readKeywordQuery(query.keyword)
    if (includeTagIds.length === 0 && excludeTagIds.length === 0 && keyword.length === 0) {
      const memos = await listMemosForAccount(db, accountId)
      return { memos: memos.map(toMemoItem), applied: null }
    }
    const filtered = await listMemosByFilter(db, {
      accountId,
      includeTagIds,
      excludeTagIds,
      keyword,
    })
    return {
      memos: filtered.memos.map(toMemoItem),
      applied: {
        id: null,
        name: null,
        keyword,
        includeTags: filtered.includeTags.map(toFilterTag),
        excludeTags: filtered.excludeTags.map(toFilterTag),
      },
    }
  } catch (error) {
    throw mapFilterError(error)
  }
}

export async function addEmptyMemo(event: H3Event): Promise<MemoItem> {
  const accountId = await requireAccount(event)
  const created = await insertMemo(await getDb(), { accountId, body: NEW_MEMO_BODY })
  const memo = await getMemoForAccount(await getDb(), accountId, created.id)
  if (!memo) {
    throw new AccountActionError(500, '메모를 만들지 못했습니다.')
  }
  return toMemoItem(memo)
}

export async function readOwnMemo(event: H3Event): Promise<MemoItem> {
  const accountId = await requireAccount(event)
  const memo = await getMemoForAccount(await getDb(), accountId, readMemoId(event))
  if (!memo) {
    throw new AccountActionError(404, '메모를 찾지 못했습니다.')
  }
  return toMemoItem(memo)
}

export async function saveOwnMemo(event: H3Event): Promise<MemoItem> {
  const accountId = await requireAccount(event)
  const body = await readBody(event)
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const markdown = record.body
  const baseVersion = record.baseVersion
  if (typeof markdown !== 'string') {
    throw new AccountActionError(400, '입력 오류: 본문이 필요합니다.')
  }
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 1) {
    throw new AccountActionError(400, '입력 오류: 저장 버전이 올바르지 않습니다.')
  }
  let outcome: Awaited<ReturnType<typeof saveMemoIfCurrentVersion>>
  try {
    outcome = await saveMemoIfCurrentVersion(await getDb(), {
      accountId,
      id: readMemoId(event),
      body: markdown,
      baseVersion,
    })
  } catch (error) {
    if (error instanceof StorageError) {
      throw new AccountActionError(400, `입력 오류: ${error.message}`)
    }
    throw error
  }
  if (outcome.kind === 'missing') {
    throw new AccountActionError(404, '메모를 찾지 못했습니다.')
  }
  if (outcome.kind === 'conflict') {
    throw new AccountActionError(409, '저장 버전이 달라 저장하지 못했습니다.')
  }
  return toMemoItem(outcome.memo)
}

export async function removeOwnMemo(event: H3Event): Promise<{ ok: true }> {
  const accountId = await requireAccount(event)
  const removed = await deleteMemoForAccount(await getDb(), {
    accountId,
    id: readMemoId(event),
  })
  if (!removed) {
    throw new AccountActionError(404, '메모를 찾지 못했습니다.')
  }
  return { ok: true }
}

function toMemoItem(memo: MemoRecord): MemoItem {
  return {
    id: memo.id,
    body: memo.body,
    version: memo.version,
    updatedAt: memo.updatedAt,
  }
}

function readOptionalText(value: unknown): string {
  if (value == null || value === '') {
    return ''
  }
  if (typeof value === 'string') {
    return value.trim()
  }
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
    return value[0].trim()
  }
  throw new AccountActionError(400, '조건 오류: 필터 조건이 올바르지 않습니다.')
}

function readTagQuery(value: unknown): string[] {
  if (value == null || value === '') {
    return []
  }
  const source = Array.isArray(value) ? value : [value]
  const ids: string[] = []
  for (const item of source) {
    if (typeof item !== 'string') {
      throw new AccountActionError(400, '조건 오류: 태그 조건이 올바르지 않습니다.')
    }
    for (const id of item.split(',')) {
      const trimmed = id.trim()
      if (trimmed) {
        ids.push(trimmed)
      }
    }
  }
  return ids
}

function readKeywordQuery(value: unknown): string {
  if (value == null || value === '') {
    return ''
  }
  if (Array.isArray(value)) {
    if (value.length > 1) {
      throw new AccountActionError(400, '키워드는 하나여야 합니다.')
    }
    return readKeywordQuery(value[0])
  }
  if (typeof value !== 'string') {
    throw new AccountActionError(400, '키워드는 하나여야 합니다.')
  }
  return value
}

async function requireAccount(event: H3Event): Promise<string> {
  const accountId = await getSessionAccountId(event)
  if (!accountId) {
    throw new AccountActionError(401, '로그인이 필요합니다.')
  }
  return accountId
}

function readMemoId(event: H3Event): string {
  const id = getRouterParam(event, 'id')?.trim()
  if (!id) {
    throw new AccountActionError(404, '메모를 찾지 못했습니다.')
  }
  return id
}
