import { readBody, type H3Event } from 'h3'
import type { FilterItem, FilterTagRef } from '../../types/filter'
import { filterNameMessage, filterOverlapMessage } from '../../utils/filter-condition'
import {
  getSavedFilterForAccount,
  insertSavedFilter,
  listSavedFiltersForAccount,
  StorageError,
  type SavedFilterView,
  type TagRecord,
} from '../db/records'
import { AccountActionError } from './account-access'
import { getDb } from './db'
import { getSessionAccountId } from './session'

const duplicateName = '같은 이름의 필터가 이미 있습니다.'
const foreignTag = '이 계정의 태그만 필터에 넣을 수 있습니다.'

export async function listOwnFilters(event: H3Event): Promise<{ filters: FilterItem[] }> {
  const accountId = await requireAccount(event)
  const filters = await listSavedFiltersForAccount(await getDb(), accountId)
  return { filters: filters.map(toFilterItem) }
}

export async function addOwnFilter(event: H3Event): Promise<FilterItem> {
  const accountId = await requireAccount(event)
  const input = await readFilterInput(event)
  let created: { id: string }
  try {
    created = await insertSavedFilter(await getDb(), {
      accountId,
      name: input.name,
      includeTagIds: input.includeTagIds,
      excludeTagIds: input.excludeTagIds,
      keyword: input.keyword,
    })
  } catch (error) {
    throw mapFilterError(error)
  }
  const saved = await getSavedFilterForAccount(await getDb(), accountId, created.id)
  if (!saved) {
    throw new AccountActionError(500, '필터를 저장하지 못했습니다.')
  }
  return toFilterItem(saved)
}

export function mapFilterError(error: unknown): unknown {
  if (error instanceof AccountActionError) {
    return error
  }
  if (!(error instanceof StorageError)) {
    return error
  }
  if (error.message === '필터 이름이 필요합니다.') {
    return new AccountActionError(400, filterNameMessage)
  }
  if (error.message === '포함 태그와 제외 태그에 같은 태그가 있습니다.') {
    return new AccountActionError(400, filterOverlapMessage)
  }
  if (error.message === duplicateName) {
    return new AccountActionError(409, duplicateName)
  }
  if (error.message === foreignTag || error.message === '다른 계정의 태그는 필터에 넣을 수 없습니다.') {
    return new AccountActionError(400, foreignTag)
  }
  if (error.message === '키워드는 하나여야 합니다.') {
    return new AccountActionError(400, '키워드는 하나여야 합니다.')
  }
  return error
}

export function toFilterTag(tag: TagRecord): FilterTagRef {
  return { id: tag.id, name: tag.name }
}

function toFilterItem(filter: SavedFilterView): FilterItem {
  return {
    id: filter.id,
    name: filter.name,
    keyword: filter.keyword,
    includeTags: filter.includeTags.map(toFilterTag),
    excludeTags: filter.excludeTags.map(toFilterTag),
  }
}

async function requireAccount(event: H3Event): Promise<string> {
  const accountId = await getSessionAccountId(event)
  if (!accountId) {
    throw new AccountActionError(401, '로그인이 필요합니다.')
  }
  return accountId
}

async function readFilterInput(event: H3Event): Promise<{
  name: string
  includeTagIds: string[]
  excludeTagIds: string[]
  keyword: string
}> {
  const body = await readBody(event)
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const name = record.name
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AccountActionError(400, filterNameMessage)
  }
  return {
    name,
    includeTagIds: readIdList(record.includeTagIds),
    excludeTagIds: readIdList(record.excludeTagIds),
    keyword: readKeyword(record.keyword),
  }
}

function readIdList(value: unknown): string[] {
  if (value == null) {
    return []
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new AccountActionError(400, '조건 오류: 태그 조건이 올바르지 않습니다.')
  }
  return value
}

function readKeyword(value: unknown): string {
  if (value == null) {
    return ''
  }
  if (typeof value !== 'string') {
    throw new AccountActionError(400, '키워드는 하나여야 합니다.')
  }
  return value
}
