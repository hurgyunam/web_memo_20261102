import { createClient, type Client } from '@libsql/client'
import { createError } from 'h3'
import { useRuntimeConfig } from '#imports'
import { ensureSchema } from '../db/schema'
import { resolveTursoConfig } from '../db/turso-config'

let client: Client | undefined

export function useDb(): Client {
  if (client) {
    return client
  }
  const config = useRuntimeConfig()
  const resolved = resolveTursoConfig({
    runtimeUrl: config.tursoDatabaseUrl,
    runtimeToken: config.tursoAuthToken,
    databaseUrl: readProcessEnv('TURSO_DATABASE_URL'),
    authToken: readProcessEnv('TURSO_AUTH_TOKEN'),
    dbUrl: readProcessEnv('TURSO_DB_URL'),
    dbToken: readProcessEnv('TURSO_DB_TOKEN'),
  })
  if (!resolved.url) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '데이터베이스 접속 정보가 없습니다.',
    })
  }
  client = createClient({
    url: resolved.url,
    authToken: resolved.authToken || undefined,
  })
  return client
}

export async function getDb(): Promise<Client> {
  const db = useDb()
  await ensureSchema(db)
  return db
}

function readProcessEnv(name: string): string | undefined {
  const env = globalThis.process?.env
  if (!env) {
    return undefined
  }
  const value = env[name]
  return typeof value === 'string' ? value : undefined
}
