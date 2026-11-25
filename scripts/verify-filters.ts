import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client, type InArgs } from '@libsql/client'
import {
  deleteTagForAccount,
  getSavedFilter,
  getSavedFilterForAccount,
  insertAccount,
  insertMemo,
  insertSavedFilter,
  insertTag,
  linkMemoTag,
  listMemosByFilter,
  listMemosForAccount,
  listSavedFiltersForAccount,
  renameTagForAccount,
  StorageError,
} from '../server/db/records'

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'web-memo-filters-'))
  const db = createClient({ url: `file:${join(dir, 'verify.db').replaceAll('\\', '/')}` })
  try {
    const owner = await insertAccount(db, { email: 'owner@example.com', password: 'secret-1' })
    const other = await insertAccount(db, { email: 'other@example.com', password: 'secret-2' })
    const work = await insertTag(db, { accountId: owner.id, name: '업무' })
    const urgent = await insertTag(db, { accountId: owner.id, name: '긴급' })
    const personal = await insertTag(db, { accountId: owner.id, name: '개인' })
    const foreignWork = await insertTag(db, { accountId: other.id, name: '업무' })
    const foreignUrgent = await insertTag(db, { accountId: other.id, name: '긴급' })

    const matchEarly = await insertMemo(db, { accountId: owner.id, body: '오전 회의 안건' })
    const matchLate = await insertMemo(db, { accountId: owner.id, body: '오후 회의 안건' })
    const onlyWork = await insertMemo(db, { accountId: owner.id, body: '오전 회의 안건' })
    const withPersonal = await insertMemo(db, { accountId: owner.id, body: '오전 회의 안건' })
    const noKeyword = await insertMemo(db, { accountId: owner.id, body: '오전 메모' })
    const english = await insertMemo(db, { accountId: owner.id, body: 'Weekly MEETING notes' })
    const percent = await insertMemo(db, { accountId: owner.id, body: '100%' })
    const plain = await insertMemo(db, { accountId: owner.id, body: '메모' })
    const foreignMemo = await insertMemo(db, { accountId: other.id, body: '오전 회의 안건' })

    await linkMemoTag(db, { memoId: matchEarly.id, tagId: work.id })
    await linkMemoTag(db, { memoId: matchEarly.id, tagId: urgent.id })
    await linkMemoTag(db, { memoId: matchLate.id, tagId: work.id })
    await linkMemoTag(db, { memoId: matchLate.id, tagId: urgent.id })
    await linkMemoTag(db, { memoId: onlyWork.id, tagId: work.id })
    await linkMemoTag(db, { memoId: withPersonal.id, tagId: work.id })
    await linkMemoTag(db, { memoId: withPersonal.id, tagId: urgent.id })
    await linkMemoTag(db, { memoId: withPersonal.id, tagId: personal.id })
    await linkMemoTag(db, { memoId: noKeyword.id, tagId: work.id })
    await linkMemoTag(db, { memoId: noKeyword.id, tagId: urgent.id })
    await linkMemoTag(db, { memoId: english.id, tagId: work.id })
    await linkMemoTag(db, { memoId: english.id, tagId: urgent.id })
    await linkMemoTag(db, { memoId: foreignMemo.id, tagId: foreignWork.id })
    await linkMemoTag(db, { memoId: foreignMemo.id, tagId: foreignUrgent.id })

    await setUpdated(db, matchEarly.id, '2026-01-01T00:00:00.000Z')
    await setUpdated(db, english.id, '2026-03-01T00:00:00.000Z')
    await setUpdated(db, percent.id, '2026-04-01T00:00:00.000Z')
    await setUpdated(db, plain.id, '2026-05-01T00:00:00.000Z')
    await setUpdated(db, matchLate.id, '2026-06-01T00:00:00.000Z')
    await setUpdated(db, onlyWork.id, '2026-07-01T00:00:00.000Z')
    await setUpdated(db, withPersonal.id, '2026-08-01T00:00:00.000Z')
    await setUpdated(db, noKeyword.id, '2026-09-01T00:00:00.000Z')
    await setUpdated(db, foreignMemo.id, '2026-12-01T00:00:00.000Z')

    const before = await count(db, 'SELECT count(*) AS n FROM saved_filters')
    const example = await listMemosByFilter(db, {
      accountId: owner.id,
      includeTagIds: [work.id, urgent.id],
      excludeTagIds: [personal.id],
      keyword: '회의',
    })
    assert(await count(db, 'SELECT count(*) AS n FROM saved_filters') === before, '조건 조회가 저장 필터를 만들었습니다.')
    assert(ids(example.memos) === `${matchLate.id},${matchEarly.id}`, '포함, 제외, 키워드를 함께 적용한 목록이 다릅니다.')
    assert(example.memos.every((memo) => memo.accountId === owner.id), '조건 조회에 다른 계정의 메모가 있습니다.')
    assert(!example.memos.some((memo) => memo.id === foreignMemo.id), '다른 계정의 메모가 조건 결과에 있습니다.')

    const meeting = await listMemosByFilter(db, {
      accountId: owner.id,
      includeTagIds: [work.id, urgent.id],
      excludeTagIds: [personal.id],
      keyword: 'meeting',
    })
    assert(ids(meeting.memos) === english.id, '키워드 대소문자를 구분합니다.')

    const keywordOnly = await listMemosByFilter(db, {
      accountId: owner.id,
      includeTagIds: [],
      excludeTagIds: [],
      keyword: '회의',
    })
    assert(ids(keywordOnly.memos) === `${withPersonal.id},${onlyWork.id},${matchLate.id},${matchEarly.id}`, '키워드만 적용한 목록이 다릅니다.')

    const includeOnly = await listMemosByFilter(db, {
      accountId: owner.id,
      includeTagIds: [work.id, urgent.id],
      excludeTagIds: [],
      keyword: '',
    })
    assert(
      ids(includeOnly.memos) === `${noKeyword.id},${withPersonal.id},${matchLate.id},${english.id},${matchEarly.id}`,
      '포함 태그만 적용한 목록이 다릅니다.',
    )

    const excludeOnly = await listMemosByFilter(db, {
      accountId: owner.id,
      includeTagIds: [],
      excludeTagIds: [personal.id],
      keyword: '',
    })
    assert(
      ids(excludeOnly.memos) === `${noKeyword.id},${onlyWork.id},${matchLate.id},${plain.id},${percent.id},${english.id},${matchEarly.id}`,
      '제외 태그만 적용한 목록이 다릅니다.',
    )

    const literal = await listMemosByFilter(db, {
      accountId: owner.id,
      includeTagIds: [],
      excludeTagIds: [],
      keyword: '%',
    })
    assert(ids(literal.memos) === percent.id, '키워드를 패턴으로 해석했습니다.')

    const open = await listMemosByFilter(db, {
      accountId: owner.id,
      includeTagIds: [],
      excludeTagIds: [],
      keyword: '',
    })
    const ownList = await listMemosForAccount(db, owner.id)
    assert(ids(open.memos) === ids(ownList), '빈 조건이 메모 목록을 제한했습니다.')
    assert(!open.memos.some((memo) => memo.id === foreignMemo.id), '빈 조건에 다른 계정의 메모가 있습니다.')

    await rejectsWith(
      () => listMemosByFilter(db, {
        accountId: owner.id,
        includeTagIds: [work.id],
        excludeTagIds: [work.id],
        keyword: '회의',
      }),
      '포함 태그와 제외 태그에 같은 태그가 있습니다.',
    )
    assert(await count(db, 'SELECT count(*) AS n FROM saved_filters') === before, '조건 오류 조회가 저장 필터를 만들었습니다.')
    await rejectsWith(
      () => listMemosByFilter(db, {
        accountId: owner.id,
        includeTagIds: [foreignWork.id],
        excludeTagIds: [],
        keyword: '',
      }),
      '이 계정의 태그만 필터에 넣을 수 있습니다.',
    )

    await rejectsWith(
      () => insertSavedFilter(db, {
        accountId: owner.id,
        name: '   ',
        includeTagIds: [work.id],
        excludeTagIds: [],
        keyword: '회의',
      }),
      '필터 이름이 필요합니다.',
    )
    assert(await count(db, 'SELECT count(*) AS n FROM saved_filters') === before, '빈 이름으로 필터가 저장되었습니다.')
    await rejectsWith(
      () => insertSavedFilter(db, {
        accountId: owner.id,
        name: '회의 필터',
        includeTagIds: [work.id, urgent.id],
        excludeTagIds: [urgent.id],
        keyword: '회의',
      }),
      '포함 태그와 제외 태그에 같은 태그가 있습니다.',
    )
    assert(await count(db, 'SELECT count(*) AS n FROM saved_filters') === before, '조건 오류인데 필터가 저장되었습니다.')

    const saved = await insertSavedFilter(db, {
      accountId: owner.id,
      name: '  회의 필터  ',
      includeTagIds: [work.id, urgent.id],
      excludeTagIds: [personal.id],
      keyword: '회의',
    })
    const stored = await getSavedFilter(db, saved.id)
    assert(stored?.name === '회의 필터', '필터 이름이 저장되지 않았습니다.')
    assert(stored.keyword === '회의', '필터 키워드가 하나가 아닙니다.')
    assert(stored.includeTagIds.join(',') === `${work.id},${urgent.id}`, '포함 태그 식별자가 저장되지 않았습니다.')
    assert(stored.excludeTagIds.join(',') === personal.id, '제외 태그 식별자가 저장되지 않았습니다.')
    await rejectsWith(
      () => insertSavedFilter(db, {
        accountId: owner.id,
        name: '회의 필터',
        includeTagIds: [],
        excludeTagIds: [],
        keyword: '',
      }),
      '같은 이름의 필터가 이미 있습니다.',
    )
    assert(await count(db, 'SELECT count(*) AS n FROM saved_filters WHERE account_id = ? AND name = ?', [owner.id, '회의 필터']) === 1, '같은 이름의 필터가 또 저장되었습니다.')

    const foreignFilter = await insertSavedFilter(db, {
      accountId: other.id,
      name: '회의 필터',
      includeTagIds: [foreignWork.id],
      excludeTagIds: [],
      keyword: '회의',
    })
    const ownerFilters = await listSavedFiltersForAccount(db, owner.id)
    assert(ownerFilters.length === 1 && ownerFilters[0]?.id === saved.id, '필터 목록에 다른 계정의 필터가 있습니다.')
    assert(await getSavedFilterForAccount(db, owner.id, foreignFilter.id) === null, '다른 계정의 필터가 조회됩니다.')

    const selected = await listMemosByFilter(db, {
      accountId: owner.id,
      includeTagIds: stored.includeTagIds,
      excludeTagIds: stored.excludeTagIds,
      keyword: stored.keyword,
    })
    assert(ids(selected.memos) === ids(example.memos), '저장한 필터의 메모 목록이 조건과 다릅니다.')
    assert(!selected.memos.some((memo) => memo.accountId !== owner.id), '저장한 필터에 다른 계정의 메모가 있습니다.')

    const renamed = await renameTagForAccount(db, { accountId: owner.id, id: work.id, name: '작업' })
    assert(renamed.kind === 'renamed' && renamed.tag.id === work.id, '태그 식별자가 바뀌었습니다.')
    const renamedView = await getSavedFilterForAccount(db, owner.id, saved.id)
    assert(renamedView?.includeTags.some((tag) => tag.id === work.id && tag.name === '작업'), '필터가 바꾼 태그 이름을 보여 주지 않습니다.')
    assert((await getSavedFilter(db, saved.id))?.includeTagIds.includes(work.id), '이름 수정으로 필터가 다른 태그를 가리킵니다.')

    assert(await deleteTagForAccount(db, { accountId: owner.id, id: urgent.id }), '포함 태그를 삭제하지 못했습니다.')
    assert(await deleteTagForAccount(db, { accountId: owner.id, id: personal.id }), '제외 태그를 삭제하지 못했습니다.')
    const afterDelete = await getSavedFilterForAccount(db, owner.id, saved.id)
    assert(afterDelete !== null, '태그를 지울 때 필터가 지워졌습니다.')
    assert(afterDelete.includeTags.map((tag) => tag.id).join(',') === work.id, '삭제한 태그가 포함 목록에 남거나 다른 태그가 빠졌습니다.')
    assert(afterDelete.excludeTags.length === 0, '삭제한 태그가 제외 목록에 남았습니다.')
    assert(afterDelete.keyword === '회의', '태그 삭제가 필터 키워드를 바꿨습니다.')
  } finally {
    db.close()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }
  console.log('필터 검증을 통과했습니다.')
}

async function setUpdated(db: Client, id: string, updatedAt: string): Promise<void> {
  await db.execute({
    sql: `UPDATE memos SET updated_at = ? WHERE id = ?`,
    args: [updatedAt, id],
  })
}

function ids(memos: { id: string }[]): string {
  return memos.map((memo) => memo.id).join(',')
}

async function count(db: Client, sql: string, args: InArgs = []): Promise<number> {
  const result = await db.execute({ sql, args })
  return Number(result.rows[0]?.n)
}

async function rejectsWith(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    if (error instanceof StorageError && error.message === message) {
      return
    }
    throw error
  }
  throw new Error(`거절 메시지가 필요합니다: ${message}`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
