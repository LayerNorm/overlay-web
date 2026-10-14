import 'server-only'

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

import { adminSessionSecret } from './env'

export const ADMIN_SESSION_COOKIE = '__Host-overlay_admin_session'
export const ADMIN_AUTH_STATE_COOKIE = '__Host-overlay_admin_auth_state'

/** Absolute session lifetime: 8 hours. */
export const SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000
/** Idle timeout: 30 minutes without an authenticated request ends the session. */
export const SESSION_IDLE_TTL_MS = 30 * 60 * 1000
/** Destructive actions require a sign-in this recent. */
export const RECENT_SIGN_IN_WINDOW_MS = 30 * 60 * 1000
/** OAuth state cookie lifetime. */
export const AUTH_STATE_TTL_MS = 10 * 60 * 1000

const IV_LENGTH_BYTES = 12
const GCM_TAG_LENGTH_BYTES = 16

export type AdminSessionUser = {
  email: string
  firstName: string | null
  id: string
  lastName: string | null
}

export type AdminSession = {
  accessToken: string
  lastActiveAt: number
  refreshToken: string | null
  signedInAt: number
  user: AdminSessionUser
}

function cryptoKey(): Buffer {
  return createHash('sha256').update(adminSessionSecret()).digest()
}

function signature(payload: string): string {
  return createHmac('sha256', cryptoKey()).update(payload).digest('base64url')
}

function signatureMatches(payload: string, candidate: string): boolean {
  const expected = Buffer.from(signature(payload))
  const actual = Buffer.from(candidate)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Encrypt-then-sign a JSON payload: `base64url(iv|ciphertext|tag).hmac`. */
export function sealPayload(value: unknown): string {
  const iv = randomBytes(IV_LENGTH_BYTES)
  const cipher = createCipheriv('aes-256-gcm', cryptoKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  const payload = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64url')
  return `${payload}.${signature(payload)}`
}

export function openPayload<T>(sealed: string | null | undefined): T | null {
  if (!sealed) return null
  const separator = sealed.lastIndexOf('.')
  if (separator <= 0) return null
  const payload = sealed.slice(0, separator)
  if (!signatureMatches(payload, sealed.slice(separator + 1))) return null
  try {
    const raw = Buffer.from(payload, 'base64url')
    const iv = raw.subarray(0, IV_LENGTH_BYTES)
    const tag = raw.subarray(raw.length - GCM_TAG_LENGTH_BYTES)
    const ciphertext = raw.subarray(IV_LENGTH_BYTES, raw.length - GCM_TAG_LENGTH_BYTES)
    const decipher = createDecipheriv('aes-256-gcm', cryptoKey(), iv, {
      authTagLength: GCM_TAG_LENGTH_BYTES,
    })
    decipher.setAuthTag(tag)
    return JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
    ) as T
  } catch {
    return null
  }
}

export function openSession(value: string | null | undefined): AdminSession | null {
  const session = openPayload<AdminSession>(value)
  if (!session?.accessToken || !session.user?.id || !session.signedInAt || !session.lastActiveAt) {
    return null
  }
  return session
}

export type SessionStatus = 'active' | 'expired' | 'idle_expired'

export function sessionStatus(session: AdminSession, now: number = Date.now()): SessionStatus {
  if (now - session.signedInAt > SESSION_ABSOLUTE_TTL_MS) return 'expired'
  if (now - session.lastActiveAt > SESSION_IDLE_TTL_MS) return 'idle_expired'
  return 'active'
}

export function hasRecentSignIn(session: AdminSession, now: number = Date.now()): boolean {
  return now - session.signedInAt <= RECENT_SIGN_IN_WINDOW_MS
}

const COOKIE_FLAGS = 'Path=/; HttpOnly; Secure; SameSite=Lax'

export function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; ${COOKIE_FLAGS}; Max-Age=${maxAgeSeconds}`
}

export function sessionCookie(session: AdminSession): string {
  return serializeCookie(ADMIN_SESSION_COOKIE, sealPayload(session), Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000))
}

export function clearSessionCookie(): string {
  return serializeCookie(ADMIN_SESSION_COOKIE, '', 0)
}

export function clearAuthStateCookie(): string {
  return serializeCookie(ADMIN_AUTH_STATE_COOKIE, '', 0)
}

/** Re-minted cookie that rolls the idle window forward. */
export function touchSessionCookie(session: AdminSession, now: number = Date.now()): string {
  return sessionCookie({ ...session, lastActiveAt: now })
}
