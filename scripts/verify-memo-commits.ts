import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client, type InArgs } from '@libsql/client'
import {
  commitMemoForAccount,
  deleteMemoForAccount,
  getMemo,
  insertAccount,
  insertMemo,
  listMemoCommitsForAccount,
  saveMemoIfCurrentVersion,
  StorageError,
} from '../server/db/records'

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'web-memo-commits-'))
  const db = createClient({ url: `file:${join(dir, 'verify.db').replaceAll('\\', '/')}` })
  try {
    const owner = await insertAccount(db, { email: 'owner@example.com', password: 'secret-1' })
    const other = await insertAccount(db, { email: 'other@example.com', password: 'secret-2' })
    const memo = await insertMemo(db, { accountId: owner.id, body: '처음' })
    const kept = await insertMemo(db, { accountId: owner.id, body: '남길 메모' })

    assert(await listMemoCommitsForAccount(db, { accountId: owner.id, memoId: memo.id }) !== null, '메모의 커밋 목록을 읽지 못했습니다.')
    assert((await listMemoCommitsForAccount(db, { accountId: owner.id, memoId: memo.id }))?.length === 0, '커밋 전에 히스토리가 있습니다.')
    assert(await listMemoCommitsForAccount(db, { accountId: other.id, memoId: memo.id }) === null, '다른 계정이 히스토리를 읽습니다.')
    assert(await listMemoCommitsForAccount(db, { accountId: owner.id, memoId: 'missing-memo' }) === null, '없는 메모의 히스토리를 빈 목록으로 봅니다.')

    const first = await commitMemoForAccount(db, {
      accountId: owner.id,
      memoId: memo.id,
      body: '처음',
      baseVersion: 1,
    })
    assert(first.kind === 'created' && first.commit.seq === 1 && first.commit.body === '처음', '첫 커밋이 본문을 쌓지 못했습니다.')
    assert((await getMemo(db, memo.id))?.body === '처음' && (await getMemo(db, memo.id))?.version === 1, '커밋이 메모 본문이나 저장 버전을 바꿨습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_commits WHERE memo_id = ?', [memo.id]) === 1, '첫 커밋이 하나가 아닙니다.')

    const same = await commitMemoForAccount(db, {
      accountId: owner.id,
      memoId: memo.id,
      body: '처음',
      baseVersion: 1,
    })
    assert(same.kind === 'unchanged' && same.commit.id === first.commit.id, '같은 본문을 다시 커밋했습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_commits WHERE memo_id = ?', [memo.id]) === 1, '같은 본문 커밋이 히스토리를 늘렸습니다.')

    const saved = await saveMemoIfCurrentVersion(db, {
      accountId: owner.id,
      id: memo.id,
      body: '고친 본문',
      baseVersion: 1,
    })
    assert(saved.kind === 'saved' && saved.memo.version === 2, '커밋 전에 본문을 저장하지 못했습니다.')
    const second = await commitMemoForAccount(db, {
      accountId: owner.id,
      memoId: memo.id,
      body: '고친 본문',
      baseVersion: 2,
    })
    assert(second.kind === 'created' && second.commit.seq === 2 && second.commit.body === '고친 본문', '바뀐 본문이 다음 커밋이 되지 않았습니다.')

    const stale = await commitMemoForAccount(db, {
      accountId: owner.id,
      memoId: memo.id,
      body: '처음',
      baseVersion: 1,
    })
    assert(stale.kind === 'conflict', '오래된 저장 버전으로 커밋했습니다.')
    const mismatch = await commitMemoForAccount(db, {
      accountId: owner.id,
      memoId: memo.id,
      body: '화면과 다른 본문',
      baseVersion: 2,
    })
    assert(mismatch.kind === 'conflict', '저장본과 다른 본문을 커밋했습니다.')
    assert((await getMemo(db, memo.id))?.body === '고친 본문' && (await getMemo(db, memo.id))?.version === 2, '거절한 커밋이 메모를 바꿨습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_commits WHERE memo_id = ?', [memo.id]) === 2, '거절한 커밋이 히스토리에 남았습니다.')

    const foreign = await commitMemoForAccount(db, {
      accountId: other.id,
      memoId: memo.id,
      body: '고친 본문',
      baseVersion: 2,
    })
    assert(foreign.kind === 'missing', '다른 계정이 커밋했습니다.')
    const missing = await commitMemoForAccount(db, {
      accountId: owner.id,
      memoId: 'missing-memo',
      body: '없음',
      baseVersion: 1,
    })
    assert(missing.kind === 'missing', '없는 메모를 커밋했습니다.')
    await rejectsWith(
      () => commitMemoForAccount(db, {
        accountId: owner.id,
        memoId: memo.id,
        body: '고친 본문',
        baseVersion: 0,
      }),
      '저장 버전이 올바르지 않습니다.',
    )

    const reverted = await saveMemoIfCurrentVersion(db, {
      accountId: owner.id,
      id: memo.id,
      body: '처음',
      baseVersion: 2,
    })
    assert(reverted.kind === 'saved', '이전 본문으로 되돌리지 못했습니다.')
    const third = await commitMemoForAccount(db, {
      accountId: owner.id,
      memoId: memo.id,
      body: '처음',
      baseVersion: 3,
    })
    assert(third.kind === 'created' && third.commit.seq === 3 && third.commit.body === '처음', '예전 본문과 같아도 새 커밋이 쌓이지 않았습니다.')

    const history = await listMemoCommitsForAccount(db, { accountId: owner.id, memoId: memo.id })
    assert(history?.map((commit) => commit.seq).join(',') === '3,2,1', '히스토리가 최근 커밋부터 쌓여 있지 않습니다.')
    assert(history.map((commit) => commit.body).join('|') === '처음|고친 본문|처음', '히스토리 본문 순서가 다릅니다.')
    assert(history.every((commit) => commit.createdAt.length > 0), '커밋 시각이 없습니다.')

    const emptyMemo = await insertMemo(db, { accountId: owner.id, body: '' })
    const emptyCommit = await commitMemoForAccount(db, {
      accountId: owner.id,
      memoId: emptyMemo.id,
      body: '',
      baseVersion: 1,
    })
    assert(emptyCommit.kind === 'created' && emptyCommit.commit.body === '' && emptyCommit.commit.seq === 1, '빈 본문을 첫 커밋으로 남기지 못했습니다.')

    const keptCommit = await commitMemoForAccount(db, {
      accountId: owner.id,
      memoId: kept.id,
      body: '남길 메모',
      baseVersion: 1,
    })
    assert(keptCommit.kind === 'created', '다른 메모의 커밋을 만들지 못했습니다.')
    assert(await deleteMemoForAccount(db, { accountId: owner.id, id: memo.id }), '메모를 삭제하지 못했습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_commits WHERE memo_id = ?', [memo.id]) === 0, '삭제한 메모의 히스토리가 남았습니다.')
    assert(await count(db, 'SELECT count(*) AS n FROM memo_commits WHERE memo_id = ?', [kept.id]) === 1, '다른 메모의 히스토리가 지워졌습니다.')
    assert((await getMemo(db, kept.id))?.body === '남길 메모', '다른 메모 본문이 바뀌었습니다.')
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
  console.log('메모 커밋 히스토리 검증을 통과했습니다.')
}

async function count(db: Client, sql: string, args: InArgs): Promise<number> {
  const result = await db.execute({ sql, args })
  return Number(result.rows[0]?.n)
}

async function rejectsWith(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    assert(error instanceof StorageError && error.message === message, `다른 오류가 났습니다: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  throw new Error(`${message} 오류가 나지 않았습니다.`)
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
