import { getRouterParam, readBody, type H3Event } from 'h3'
import type { MemoCommit, MemoCommitList, MemoCommitResult } from '../../types/memo'
import {
  commitMemoForAccount,
  listMemoCommitsForAccount,
  StorageError,
  type MemoCommitRecord,
} from '../db/records'
import { AccountActionError } from './account-access'
import { getDb } from './db'
import { getSessionAccountId } from './session'

const missingMemo = '메모를 찾지 못했습니다.'

export async function listOwnMemoCommits(event: H3Event): Promise<MemoCommitList> {
  const accountId = await requireAccount(event)
  const commits = await listMemoCommitsForAccount(await getDb(), {
    accountId,
    memoId: readMemoId(event),
  })
  if (!commits) {
    throw new AccountActionError(404, missingMemo)
  }
  return { commits: commits.map(toMemoCommit) }
}

export async function commitOwnMemo(event: H3Event): Promise<MemoCommitResult> {
  const accountId = await requireAccount(event)
  const snapshot = await readCommitSnapshot(event)
  let outcome: Awaited<ReturnType<typeof commitMemoForAccount>>
  try {
    outcome = await commitMemoForAccount(await getDb(), {
      accountId,
      memoId: readMemoId(event),
      body: snapshot.body,
      baseVersion: snapshot.baseVersion,
    })
  } catch (error) {
    if (error instanceof StorageError) {
      throw new AccountActionError(400, `입력 오류: ${error.message}`)
    }
    throw error
  }
  if (outcome.kind === 'missing') {
    throw new AccountActionError(404, missingMemo)
  }
  if (outcome.kind === 'conflict') {
    throw new AccountActionError(409, '저장 버전이 달라 커밋하지 못했습니다.')
  }
  return {
    kind: outcome.kind,
    commit: toMemoCommit(outcome.commit),
  }
}

function toMemoCommit(commit: MemoCommitRecord): MemoCommit {
  return {
    id: commit.id,
    seq: commit.seq,
    body: commit.body,
    createdAt: commit.createdAt,
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

async function readCommitSnapshot(event: H3Event): Promise<{ body: string, baseVersion: number }> {
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
  return { body: markdown, baseVersion }
}
