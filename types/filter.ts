export type FilterTagRef = {
  id: string
  name: string
}

export type FilterItem = {
  id: string
  name: string
  keyword: string
  includeTags: FilterTagRef[]
  excludeTags: FilterTagRef[]
}

export type AppliedFilter = {
  id: string | null
  name: string | null
  keyword: string
  includeTags: FilterTagRef[]
  excludeTags: FilterTagRef[]
}
