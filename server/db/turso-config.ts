export type TursoConfig = {
  url: string
  authToken: string
}

export function resolveTursoConfig(input: {
  runtimeUrl: unknown
  runtimeToken: unknown
  databaseUrl: unknown
  authToken: unknown
  dbUrl?: unknown
  dbToken?: unknown
}): TursoConfig {
  return {
    url: pickString(input.runtimeUrl, input.databaseUrl, input.dbUrl),
    authToken: pickString(input.runtimeToken, input.authToken, input.dbToken),
  }
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}
