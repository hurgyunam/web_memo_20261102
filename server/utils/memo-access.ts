import { getRouterParam, readBody, type H3Event } from 'h3'
import type { MemoItem } from '../../types/memo'
import {
  deleteMemoForAccount,
  getMemoForAccount,
  insertMemo,
  listMemosForAccount,
  saveMemoIfCurrentVersion,
  StorageError,
  type MemoRecord,
} from '../db/records'
import { NEW_MEMO_BODY } from '../../utils/new-memo'
import { AccountActionError } from './account-access'
import { getDb } from './db'
import { getSessionAccountId } from './session'

export async function listOwnMemos(event: H3Event): Promise<{ memos: MemoItem[] }> {
  const accountId = await requireAccount(event)
  const memos = await listMemosForAccount(await getDb(), accountId)
  return { memos: memos.map(toMemoItem) }
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
