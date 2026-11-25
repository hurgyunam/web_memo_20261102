import type { AppliedFilter } from './filter'

export type MemoItem = {
  id: string
  body: string
  version: number
  updatedAt: string
}

export type MemoList = {
  memos: MemoItem[]
  applied: AppliedFilter | null
}

export type MemoSaveRequest = {
  body: string
  baseVersion: number
}

export type MemoCommit = {
  id: string
  seq: number
  body: string
  createdAt: string
}

export type MemoCommitList = {
  commits: MemoCommit[]
}

export type MemoCommitResult = {
  kind: 'created' | 'unchanged'
  commit: MemoCommit
}
