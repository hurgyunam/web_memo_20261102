import type { MemoItem } from './memo'

export type TagMemoRow = MemoItem & {
  linked: boolean
}

export type TagMemoAssign = {
  tag: TagItem
  memos: TagMemoRow[]
}

export type TagItem = {
  id: string
  name: string
}
