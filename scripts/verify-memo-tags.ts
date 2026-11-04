import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client, type InArgs } from '@libsql/client'
import {
  deleteMemoForAccount,
  getMemo,
  getTagForAccount,
  insertAccount,
  insertMemo,
  insertTag,
  linkMemoTagForAccount,
  listTagsForMemo,
  renameTagForAccount,
  unlinkMemoTagForAccount,
} from '../server/db/records'

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'web-memo-links-'))
  const db = createClient({ url: `file:${join(dir, 'verify.db').replaceAll('\\', '/')}` })
  try {
    const owner = await insertAccount(db, { email: 'owner@example.com', password: 'secret-1' })
    const other = await insertAccount(db, { email: 'other@example.com', password: 'secret-2' })
    const memoA = await insertMemo(db, { accountId: owner.id, body: '가 메모' })
    const memoB = await insertMemo(db, { accountId: owner.id, body: '나 메모' })
    const work = await insertTag(db, { accountId: owner.id, name: '업무' })
    const urgent = await insertTag(db, { accountId: owner.id, name: '긴급' })
    const foreign = await insertTag(db, { accountId: other.id, name: '비밀' })

    assert(await listTagsForMemo(db, { accountId: owner.id, memoId: memoA.id }) !== null, '메모의 태그 목록을 읽지 못했습니다.')
    assert((await listTagsForMemo(db, { accountId: owner.id, memoId: memoA.id }))?.length === 0, '연결 전에 태그가 표시됩니다.')

    const linked = await linkMemoTagForAccount(db, { accountId: owner.id, memoId: memoA.id, tagId: work.id })
    assert(linked.kind === 'linked' && linked.tag.id === work.id && linked.tag.name === '업무', '고른 태그가 연결되지 않았습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE memo_id = ? AND tag_id = ?', [memoA.id, work.id]) === 1, '연결이 하나가 아닙니다.')
    assert((await getMemo(db, memoA.id))?.body === '가 메모', '연결이 메모 본문을 바꿨습니다.')

    const again = await linkMemoTagForAccount(db, { accountId: owner.id, memoId: memoA.id, tagId: work.id })
    assert(again.kind === 'linked' && again.tag.id === work.id, '이미 연결된 태그를 다시 고르면 실패합니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE memo_id = ? AND tag_id = ?', [memoA.id, work.id]) === 1, '같은 태그를 다시 골랐더니 연결이 늘었습니다.')

    const otherMemo = await linkMemoTagForAccount(db, { accountId: owner.id, memoId: memoB.id, tagId: work.id })
    assert(otherMemo.kind === 'linked', '같은 태그를 다른 메모에 연결하지 못했습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE tag_id = ?', [work.id]) === 2, '메모마다 연결이 따로 생기지 않았습니다.')
    await linkMemoTagForAccount(db, { accountId: owner.id, memoId: memoA.id, tagId: urgent.id })

    const columns = await db.execute('PRAGMA table_info(memo_tags)')
    assert(JSON.stringify(columns.rows.map((row) => String(row.name))) === JSON.stringify(['memo_id', 'tag_id']), '연결이 태그 이름을 저장합니다.')
    assert(names(await listTagsForMemo(db, { accountId: owner.id, memoId: memoA.id })) === '긴급,업무', '연결된 태그 표시가 다릅니다.')

    const renamed = await renameTagForAccount(db, { accountId: owner.id, id: work.id, name: '작업' })
    assert(renamed.kind === 'renamed' && renamed.tag.id === work.id, '태그 식별자가 바뀌었습니다.')
    assert(names(await listTagsForMemo(db, { accountId: owner.id, memoId: memoA.id })) === '긴급,작업', '이름을 바꿔도 이 메모의 표시가 그대로입니다.')
    assert(names(await listTagsForMemo(db, { accountId: owner.id, memoId: memoB.id })) === '작업', '이름을 바꿔도 다른 메모의 표시가 그대로입니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE tag_id = ?', [work.id]) === 2, '이름 수정으로 연결이 끊어졌습니다.')

    assert(await unlinkMemoTagForAccount(db, { accountId: owner.id, memoId: memoA.id, tagId: work.id }) === 'removed', '연결을 제거하지 못했습니다.')
    assert(names(await listTagsForMemo(db, { accountId: owner.id, memoId: memoA.id })) === '긴급', '제거한 태그가 이 메모에 남습니다.')
    assert(names(await listTagsForMemo(db, { accountId: owner.id, memoId: memoB.id })) === '작업', '다른 메모의 연결까지 제거되었습니다.')
    assert(await getTagForAccount(db, owner.id, work.id) !== null, '연결 제거가 태그를 지웠습니다.')
    assert(await unlinkMemoTagForAccount(db, { accountId: owner.id, memoId: memoA.id, tagId: work.id }) === 'missing-link', '없는 연결 제거를 구분하지 못했습니다.')

    const foreignLink = await linkMemoTagForAccount(db, { accountId: owner.id, memoId: memoA.id, tagId: foreign.id })
    assert(foreignLink.kind === 'missing-tag', '다른 계정의 태그가 연결되었습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE tag_id = ?', [foreign.id]) === 0, '다른 계정 태그 연결이 남았습니다.')
    assert(await listTagsForMemo(db, { accountId: owner.id, memoId: 'missing-memo' }) === null, '없는 메모의 태그 목록을 만들었습니다.')
    assert((await linkMemoTagForAccount(db, { accountId: owner.id, memoId: 'missing-memo', tagId: work.id })).kind === 'missing-memo', '없는 메모에 태그가 연결되었습니다.')

    const tagCount = await count(db, 'SELECT count(*) AS n FROM tags')
    assert(await deleteMemoForAccount(db, { accountId: owner.id, id: memoB.id }), '메모를 삭제하지 못했습니다.')
    assert(await getMemo(db, memoB.id) === null, '삭제한 메모가 조회됩니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_tags WHERE memo_id = ?', [memoB.id]) === 0, '삭제한 메모의 태그 연결이 남았습니다.')
    assert(await getTagForAccount(db, owner.id, work.id) !== null, '메모 삭제가 태그를 지웠습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM tags') === tagCount, '메모 삭제가 다른 태그를 바꿨습니다.')
    assert(names(await listTagsForMemo(db, { accountId: owner.id, memoId: memoA.id })) === '긴급', '다른 메모의 연결이 지워졌습니다.')
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
  console.log('메모와 태그 연결 검증을 통과했습니다.')
}

function names(tags: Array<{ name: string }> | null): string {
  return (tags ?? []).map((tag) => tag.name).join(',')
}

async function count(db: Client, sql: string, args: InArgs): Promise<number> {
  const result = await db.execute({ sql, args })
  return Number(result.rows[0]?.n)
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
