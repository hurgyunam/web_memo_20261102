import { getRouterParam, type H3Event } from 'h3'
import type { MemoItem } from '../../types/memo'
import {
  deleteMemoForAccount,
  getMemoForAccount,
  insertMemo,
  listMemosForAccount,
  type MemoRecord,
} from '../db/records'
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
  const created = await insertMemo(await getDb(), { accountId, body: '' })
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
