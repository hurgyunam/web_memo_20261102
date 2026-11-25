import { getRouterParam, readBody, type H3Event } from 'h3'
import type { TagMemoAssign } from '../../types/tag'
import {
  linkTagToMemosForAccount,
  listTagMemoAssign,
  type MemoRecord,
  type TagRecord,
} from '../db/records'
import { AccountActionError } from './account-access'
import { getDb } from './db'
import { getSessionAccountId } from './session'

const missingTag = '태그를 찾지 못했습니다.'
const missingMemo = '메모를 찾지 못했습니다.'
const emptySelection = '입력 오류: 메모를 선택해 주세요.'

export async function listOwnTagMemos(event: H3Event): Promise<TagMemoAssign> {
  const accountId = await requireAccount(event)
  const listed = await listTagMemoAssign(await getDb(), {
    accountId,
    tagId: readTagId(event),
  })
  if (!listed) {
    throw new AccountActionError(404, missingTag)
  }
  return {
    tag: toTagItem(listed.tag),
    memos: listed.memos.map(toMemoRow),
  }
}

export async function linkOwnTagMemos(event: H3Event): Promise<{ memoIds: string[] }> {
  const accountId = await requireAccount(event)
  const outcome = await linkTagToMemosForAccount(await getDb(), {
    accountId,
    tagId: readTagId(event),
    memoIds: await readMemoIds(event),
  })
  if (outcome.kind === 'missing-tag') {
    throw new AccountActionError(404, missingTag)
  }
  if (outcome.kind === 'missing-memo') {
    throw new AccountActionError(404, missingMemo)
  }
  return { memoIds: outcome.memoIds }
}

function toTagItem(tag: TagRecord): TagMemoAssign['tag'] {
  return { id: tag.id, name: tag.name }
}

function toMemoRow(memo: MemoRecord & { linked: boolean }): TagMemoAssign['memos'][number] {
  return {
    id: memo.id,
    body: memo.body,
    version: memo.version,
    updatedAt: memo.updatedAt,
    linked: memo.linked,
  }
}

async function requireAccount(event: H3Event): Promise<string> {
  const accountId = await getSessionAccountId(event)
  if (!accountId) {
    throw new AccountActionError(401, '로그인이 필요합니다.')
  }
  return accountId
}

function readTagId(event: H3Event): string {
  const id = getRouterParam(event, 'id')?.trim()
  if (!id) {
    throw new AccountActionError(404, missingTag)
  }
  return id
}

async function readMemoIds(event: H3Event): Promise<string[]> {
  const body = await readBody(event)
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const memoIds = record.memoIds
  if (!Array.isArray(memoIds) || memoIds.length === 0) {
    throw new AccountActionError(400, emptySelection)
  }
  const ids = memoIds.map((id) => (typeof id === 'string' ? id.trim() : ''))
  if (ids.some((id) => id.length === 0)) {
    throw new AccountActionError(400, emptySelection)
  }
  return ids
}
