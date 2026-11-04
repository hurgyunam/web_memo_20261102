export const NEW_MEMO_BODY = '# 제목...\n'

export function isNewMemoBody(body: string): boolean {
  return body.replace(/\s+$/u, '') === '# 제목...'
}
