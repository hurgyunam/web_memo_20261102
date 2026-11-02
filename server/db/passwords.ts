import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
const MAX_N = 1_048_576
const MAX_R = 32
const MAX_P = 8

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await deriveKey(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false
  }
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  const saltPart = parts[4]
  const hashPart = parts[5]
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false
  }
  if (n <= 1 || r <= 0 || p <= 0 || n > MAX_N || r > MAX_R || p > MAX_P) {
    return false
  }
  if (!saltPart || !hashPart) {
    return false
  }
  const salt = Buffer.from(saltPart, 'base64url')
  const expected = Buffer.from(hashPart, 'base64url')
  if (salt.length === 0 || expected.length === 0) {
    return false
  }
  const derived = await deriveKey(password, salt, expected.length, { N: n, r, p })
  if (derived.length !== expected.length) {
    return false
  }
  return timingSafeEqual(derived, expected)
}

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number, r: number, p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) {
        reject(error)
        return
      }
      resolve(derived)
    })
  })
}
