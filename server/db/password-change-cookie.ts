import { deleteCookie, getCookie, getRequestProtocol, setCookie, type H3Event } from 'h3'
import { SECURITY_CODE_TTL_MS } from './security-code'

export const PASSWORD_CHANGE_COOKIE_NAME = 'password_change'

export type PasswordChangeCookieOptions = {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: '/'
  maxAge: number
}

export function passwordChangeCookieOptions(secure: boolean): PasswordChangeCookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SECURITY_CODE_TTL_MS / 1000),
  }
}

export function applyPasswordChangeCookie(event: H3Event, token: string): void {
  setCookie(event, PASSWORD_CHANGE_COOKIE_NAME, token, passwordChangeCookieOptions(requestIsSecure(event)))
}

export function clearPasswordChangeCookie(event: H3Event): void {
  deleteCookie(event, PASSWORD_CHANGE_COOKIE_NAME, passwordChangeCookieOptions(requestIsSecure(event)))
}

export function readPasswordChangeToken(event: H3Event): string | undefined {
  const token = getCookie(event, PASSWORD_CHANGE_COOKIE_NAME)
  return token || undefined
}

function requestIsSecure(event: H3Event): boolean {
  return getRequestProtocol(event) === 'https'
}
