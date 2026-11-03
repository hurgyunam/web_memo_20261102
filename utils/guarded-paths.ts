export const accountAreas = ['/memos', '/tags', '/filters'] as const

export function isAccountArea(path: string): boolean {
  return accountAreas.some((area) => path === area || path.startsWith(`${area}/`))
}

export function isAccountApi(path: string): boolean {
  return accountAreas.some((area) => {
    const apiPath = `/api${area}`
    return path === apiPath || path.startsWith(`${apiPath}/`)
  })
}
