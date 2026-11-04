import { getRouterParam, readBody, type H3Event } from 'h3'
import type { TagItem } from '../../types/tag'
import {
  deleteTagForAccount,
  getTagForAccount,
  insertTag,
  listTagsForAccount,
  renameTagForAccount,
  StorageError,
  type TagRecord,
} from '../db/records'
import { AccountActionError } from './account-access'
import { getDb } from './db'
import { getSessionAccountId } from './session'

const emptyName = '입력 오류: 태그 이름을 입력해 주세요.'
const duplicateName = '같은 이름의 태그가 이미 있습니다.'

export async function listOwnTags(event: H3Event): Promise<{ tags: TagItem[] }> {
  const accountId = await requireAccount(event)
  const tags = await listTagsForAccount(await getDb(), accountId)
  return { tags: tags.map(toTagItem) }
}

export async function addOwnTag(event: H3Event): Promise<TagItem> {
  const accountId = await requireAccount(event)
  const name = await readTagName(event)
  let created: { id: string }
  try {
    created = await insertTag(await getDb(), { accountId, name })
  } catch (error) {
    throw mapTagError(error)
  }
  const tag = await getTagForAccount(await getDb(), accountId, created.id)
  if (!tag) {
    throw new AccountActionError(500, '태그를 만들지 못했습니다.')
  }
  return toTagItem(tag)
}

export async function renameOwnTag(event: H3Event): Promise<TagItem> {
  const accountId = await requireAccount(event)
  const name = await readTagName(event)
  let outcome: Awaited<ReturnType<typeof renameTagForAccount>>
  try {
    outcome = await renameTagForAccount(await getDb(), {
      accountId,
      id: readTagId(event),
      name,
    })
  } catch (error) {
    throw mapTagError(error)
  }
  if (outcome.kind === 'missing') {
    throw new AccountActionError(404, '태그를 찾지 못했습니다.')
  }
  return toTagItem(outcome.tag)
}

export async function removeOwnTag(event: H3Event): Promise<{ ok: true }> {
  const accountId = await requireAccount(event)
  const removed = await deleteTagForAccount(await getDb(), {
    accountId,
    id: readTagId(event),
  })
  if (!removed) {
    throw new AccountActionError(404, '태그를 찾지 못했습니다.')
  }
  return { ok: true }
}

function toTagItem(tag: TagRecord): TagItem {
  return {
    id: tag.id,
    name: tag.name,
  }
}

function mapTagError(error: unknown): unknown {
  if (error instanceof StorageError && error.message === '태그 이름이 필요합니다.') {
    return new AccountActionError(400, emptyName)
  }
  if (error instanceof StorageError && error.message === duplicateName) {
    return new AccountActionError(409, duplicateName)
  }
  return error
}

async function requireAccount(event: H3Event): Promise<string> {
  const accountId = await getSessionAccountId(event)
  if (!accountId) {
    throw new AccountActionError(401, '로그인이 필요합니다.')
  }
  return accountId
}

async function readTagName(event: H3Event): Promise<string> {
  const body = await readBody(event)
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const name = record.name
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AccountActionError(400, emptyName)
  }
  return name
}

function readTagId(event: H3Event): string {
  const id = getRouterParam(event, 'id')?.trim()
  if (!id) {
    throw new AccountActionError(404, '태그를 찾지 못했습니다.')
  }
  return id
}
