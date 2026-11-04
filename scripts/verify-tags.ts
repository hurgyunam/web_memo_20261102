import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client, type InArgs } from '@libsql/client'
import {
  deleteTagForAccount,
  getMemo,
  getSavedFilter,
  getTagForAccount,
  insertAccount,
  insertMemo,
  insertSavedFilter,
  insertTag,
  linkMemoTag,
  listTagsForAccount,
  renameTagForAccount,
  StorageError,
} from '../server/db/records'

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'web-memo-tags-'))
  const db = createClient({ url: `file:${join(dir, 'verify.db').replaceAll('\\', '/')}` })
  try {
    const owner = await insertAccount(db, { email: 'owner@example.com', password: 'secret-1' })
    const other = await insertAccount(db, { email: 'other@example.com', password: 'secret-2' })
    const memo = await insertMemo(db, { accountId: owner.id, body: '본문 유지' })
    const otherMemo = await insertMemo(db, { accountId: owner.id, body: '다른 메모' })

    await rejectsWith(
      () => insertTag(db, { accountId: owner.id, name: '   ' }),
      '태그 이름이 필요합니다.',
    )
    assert((await listTagsForAccount(db, owner.id)).length === 0, '빈 이름으로 태그가 생겼습니다.')

    const work = await insertTag(db, { accountId: owner.id, name: '  업무  ' })
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE tag_id = ?', [work.id]) === 0, '만든 직후 메모와 연결되어 있습니다.')
    const created = await getTagForAccount(db, owner.id, work.id)
    assert(created?.name === '업무' && created.accountId === owner.id, '태그 이름이 계정에 저장되지 않았습니다.')

    await rejectsWith(
      () => insertTag(db, { accountId: owner.id, name: '업무' }),
      '같은 이름의 태그가 이미 있습니다.',
    )
    assert((await listTagsForAccount(db, owner.id)).length === 1, '같은 이름의 태그가 또 생겼습니다.')

    const urgent = await insertTag(db, { accountId: owner.id, name: '긴급' })
    const personal = await insertTag(db, { accountId: owner.id, name: '개인' })
    const foreign = await insertTag(db, { accountId: other.id, name: '업무' })
    await linkMemoTag(db, { memoId: memo.id, tagId: work.id })
    await linkMemoTag(db, { memoId: otherMemo.id, tagId: work.id })
    await linkMemoTag(db, { memoId: memo.id, tagId: urgent.id })
    const filter = await insertSavedFilter(db, {
      accountId: owner.id,
      name: '업무 필터',
      includeTagIds: [work.id, urgent.id],
      excludeTagIds: [personal.id],
      keyword: '회의',
    })

    const own = await listTagsForAccount(db, owner.id)
    assert(own.every((tag) => tag.accountId === owner.id), '목록에 다른 계정의 태그가 있습니다.')
    assert(!own.some((tag) => tag.id === foreign.id), '다른 계정의 태그가 목록에 있습니다.')
    assert(JSON.stringify(own.map((tag) => tag.name)) === JSON.stringify(['개인', '긴급', '업무']), '태그 목록 순서가 다릅니다.')
    assert(await getTagForAccount(db, owner.id, foreign.id) === null, '다른 계정의 태그가 조회됩니다.')
    const foreignList = await listTagsForAccount(db, other.id)
    assert(foreignList.length === 1 && foreignList[0]?.id === foreign.id, '다른 계정의 자기 태그가 목록에 없습니다.')

    await rejectsWith(
      () => renameTagForAccount(db, { accountId: owner.id, id: work.id, name: '  ' }),
      '태그 이름이 필요합니다.',
    )
    assert((await getTagForAccount(db, owner.id, work.id))?.name === '업무', '빈 이름이 반영되었습니다.')
    await rejectsWith(
      () => renameTagForAccount(db, { accountId: owner.id, id: work.id, name: '긴급' }),
      '같은 이름의 태그가 이미 있습니다.',
    )
    assert((await getTagForAccount(db, owner.id, work.id))?.name === '업무', '이미 있는 이름으로 바뀌었습니다.')

    const renamed = await renameTagForAccount(db, { accountId: owner.id, id: work.id, name: '  작업  ' })
    assert(renamed.kind === 'renamed' && renamed.tag.id === work.id && renamed.tag.name === '작업', '태그 식별자를 유지한 채 이름만 바꾸지 못했습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE tag_id = ?', [work.id]) === 2, '이름 수정으로 메모 연결이 끊어졌습니다.')
    assert((await getSavedFilter(db, filter.id))?.includeTagIds.includes(work.id), '이름 수정으로 필터가 다른 태그를 가리킵니다.')

    const foreignRename = await renameTagForAccount(db, { accountId: owner.id, id: foreign.id, name: '침범' })
    assert(foreignRename.kind === 'missing', '다른 계정의 태그가 수정되었습니다.')
    assert((await getTagForAccount(db, other.id, foreign.id))?.name === '업무', '다른 계정 태그의 이름이 바뀌었습니다.')

    const memoBody = (await getMemo(db, memo.id))?.body
    assert(await deleteTagForAccount(db, { accountId: owner.id, id: foreign.id }) === false, '다른 계정의 태그가 삭제되었습니다.')
    assert(await getTagForAccount(db, other.id, foreign.id) !== null, '다른 계정 태그가 지워졌습니다.')
    assert(await deleteTagForAccount(db, { accountId: owner.id, id: work.id }), '태그를 삭제하지 못했습니다.')
    assert(await getTagForAccount(db, owner.id, work.id) === null, '삭제한 태그가 조회됩니다.')
    assert(!(await listTagsForAccount(db, owner.id)).some((tag) => tag.id === work.id), '삭제한 태그가 목록에 남습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE tag_id = ?', [work.id]) === 0, '삭제한 태그의 메모 연결이 남았습니다.')
    assert((await getMemo(db, memo.id))?.body === memoBody, '태그를 지울 때 메모 본문이 바뀌었습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE memo_id = ? AND tag_id = ?', [memo.id, urgent.id]) === 1, '다른 태그의 연결이 지워졌습니다.')
    assert(await getTagForAccount(db, owner.id, urgent.id) !== null, '다른 태그가 지워졌습니다.')
    assert(await getTagForAccount(db, owner.id, personal.id) !== null, '연결 없는 다른 태그가 지워졌습니다.')
    const saved = await getSavedFilter(db, filter.id)
    assert(saved !== null && !saved.includeTagIds.includes(work.id), '삭제한 태그가 필터에 남았습니다.')
    assert(saved.includeTagIds.includes(urgent.id) && saved.excludeTagIds.includes(personal.id), '다른 태그 필터 연결이 지워졌습니다.')
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
  console.log('태그 목록 검증을 통과했습니다.')
}

async function count(db: Client, sql: string, args: InArgs): Promise<number> {
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
