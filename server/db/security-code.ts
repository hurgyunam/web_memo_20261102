import { randomInt, timingSafeEqual } from 'node:crypto'
import type { Client } from '@libsql/client'
import {
  deleteExpiredSecurityCodes,
  deleteSecurityCodeById,
  deleteSecurityCodes,
  insertSecurityCode,
  listSecurityCodes,
  type SecurityCodePurpose,
} from './records'

export const SECURITY_CODE_TTL_MS = 10 * 60 * 1000

export function generateSecurityCode(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, '0')
}

export async function issueSecurityCode(
  db: Client,
  input: {
    accountId: string
    purpose: SecurityCodePurpose
    nowMs?: number
    ttlMs?: number
  },
): Promise<{ id: string, code: string, expiresAt: string }> {
  const nowMs = input.nowMs ?? Date.now()
  const ttlMs = input.ttlMs ?? SECURITY_CODE_TTL_MS
  const code = generateSecurityCode()
  const expiresAt = new Date(nowMs + ttlMs).toISOString()
  await deleteSecurityCodes(db, { accountId: input.accountId, purpose: input.purpose })
  const created = await insertSecurityCode(db, {
    accountId: input.accountId,
    code,
    purpose: input.purpose,
    expiresAt,
  })
  return { id: created.id, code, expiresAt }
}

export async function consumeSecurityCode(
  db: Client,
  input: {
    accountId: string
    purpose: SecurityCodePurpose
    code: string
    nowMs?: number
  },
): Promise<boolean> {
  const nowMs = input.nowMs ?? Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const code = input.code.trim()
  const rows = /^\d{8}$/.test(code)
    ? await listSecurityCodes(db, { accountId: input.accountId, purpose: input.purpose })
    : []
  const matched = rows.find((row) => row.expiresAt > nowIso && sameCode(row.code, code))
  await deleteExpiredSecurityCodes(db, {
    accountId: input.accountId,
    purpose: input.purpose,
    nowIso,
  })
  if (!matched) {
    return false
  }
  return deleteSecurityCodeById(db, matched.id)
}

function sameCode(stored: string, input: string): boolean {
  const left = Buffer.from(stored)
  const right = Buffer.from(input)
  if (left.length !== right.length) {
    return false
  }
  return timingSafeEqual(left, right)
}
