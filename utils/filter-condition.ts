export const filterOverlapMessage = '조건 오류: 포함 태그와 제외 태그에 같은 태그가 있습니다.'
export const filterNameMessage = '입력 오류: 필터 이름을 입력해 주세요.'

export function hasTagOverlap(includeTagIds: string[], excludeTagIds: string[]): boolean {
  const exclude = new Set(excludeTagIds)
  return includeTagIds.some((id) => id.length > 0 && exclude.has(id))
}
