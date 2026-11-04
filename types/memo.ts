export type MemoItem = {
  id: string
  body: string
  version: number
  updatedAt: string
}

export type MemoSaveRequest = {
  body: string
  baseVersion: number
}
