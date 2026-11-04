import { getRouterParam, readBody, type H3Event } from 'h3'
import type { TagItem } from '../../types/tag'
import {
  linkMemoTagForAccount,
  listTagsForMemo,
  StorageError,
  unlinkMemoTagForAccount,
  type TagRecord,
} from '../db/records'
import { AccountActionError } from './account-access'
import { getDb } from './db'
import { getSessionAccountId } from './session'

const missingMemo = '메모를 찾지 못했습니다.'
const missingTag = '태그를 찾지 못했습니다.'
const missingLink = '태그 연결을 찾지 못했습니다.'

export async function listOwnMemoTags(event: H3Event): Promise<{ tags: TagItem[] }> {
  const accountId = await requireAccount(event)
  const tags = await listTagsForMemo(await getDb(), {
    accountId,
    memoId: readMemoId(event),
  })
  if (!tags) {
    throw new AccountActionError(404, missingMemo)
  }
  return { tags: tags.map(toTagItem) }
}

export async function linkOwnMemoTag(event: H3Event): Promise<TagItem> {
  const accountId = await requireAccount(event)
  let outcome: Awaited<ReturnType<typeof linkMemoTagForAccount>>
  try {
    outcome = await linkMemoTagForAccount(await getDb(), {
      accountId,
      memoId: readMemoId(event),
      tagId: await readTagId(event),
    })
  } catch (error) {
    if (error instanceof StorageError && error.message === '다른 계정의 태그는 연결할 수 없습니다.') {
      throw new AccountActionError(404, missingTag)
    }
    throw error
  }
  if (outcome.kind === 'missing-memo') {
    throw new AccountActionError(404, missingMemo)
  }
  if (outcome.kind === 'missing-tag') {
    throw new AccountActionError(404, missingTag)
  }
  return toTagItem(outcome.tag)
}

export async function unlinkOwnMemoTag(event: H3Event): Promise<{ ok: true }> {
  const accountId = await requireAccount(event)
  const outcome = await unlinkMemoTagForAccount(await getDb(), {
    accountId,
    memoId: readMemoId(event),
    tagId: readLinkTagId(event),
  })
  if (outcome === 'missing-memo') {
    throw new AccountActionError(404, missingMemo)
  }
  if (outcome === 'missing-link') {
    throw new AccountActionError(404, missingLink)
  }
  return { ok: true }
}

function toTagItem(tag: TagRecord): TagItem {
  return {
    id: tag.id,
    name: tag.name,
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
    throw new AccountActionError(404, missingMemo)
  }
  return id
}

async function readTagId(event: H3Event): Promise<string> {
  const body = await readBody(event)
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const tagId = record.tagId
  if (typeof tagId !== 'string' || tagId.trim().length === 0) {
    throw new AccountActionError(400, '입력 오류: 태그를 선택해 주세요.')
  }
  return tagId.trim()
}

function readLinkTagId(event: H3Event): string {
  const id = getRouterParam(event, 'tagId')?.trim()
  if (!id) {
    throw new AccountActionError(404, missingLink)
  }
  return id
}
