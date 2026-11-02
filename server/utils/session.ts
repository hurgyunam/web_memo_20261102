import type { H3Event } from 'h3'
import { getCookie } from 'h3'
import { deleteSession, findSessionAccountId, insertSession } from '../db/records'
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  applySessionCookie,
  clearSessionCookie,
  createSessionToken,
  hashSessionToken,
} from '../db/session-cookie'
import { getDb } from './db'

export async function openSession(event: H3Event, accountId: string): Promise<void> {
  const db = await getDb()
  const token = createSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()
  await insertSession(db, {
    tokenHash: hashSessionToken(token),
    accountId,
    expiresAt,
  })
  applySessionCookie(event, token)
}

export async function closeSession(event: H3Event): Promise<void> {
  const token = getCookie(event, SESSION_COOKIE_NAME)
  try {
    if (token) {
      await deleteSession(await getDb(), hashSessionToken(token))
    }
  } finally {
    clearSessionCookie(event)
  }
}

export async function getSessionAccountId(event: H3Event): Promise<string | null> {
  const token = getCookie(event, SESSION_COOKIE_NAME)
  if (!token) {
    return null
  }
  return findSessionAccountId(await getDb(), hashSessionToken(token))
}
