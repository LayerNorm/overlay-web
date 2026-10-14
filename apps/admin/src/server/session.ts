import 'server-only'

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'
import { requiredEnv } from '@/server/env'

/**
 * `__Host-overlay_admin_session` — the admin app's own session cookie.
 *
 * Plain language: the cookie value is `base64url(payload).hmac`. The payload
 * holds the WorkOS access + refresh tokens and the signed-in user. The HMAC
 * (keyed by ADMIN_SESSION_SECRET, *not* the web SESSION_SECRET) makes the
 * payload tamper-proof. `__Host-` prefix requires Secure, path=/, no Domain —
 * so no sibling subdomain can shadow it.
 *
 * Lifetime: 8-hour absolute expiry plus a 30-minute idle timeout (lastSeenAt
 * is refreshed whenever a request touches the session).
 */
export const ADMIN_SESSION_COOKIE = '__Host-overlay_admin_session'
export const ADMIN_OAUTH_STATE_COOKIE = '__Host-overlay_admin_oauth_state'

const ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000
const IDLE_TTL_MS = 30 * 60 * 1000

export interface AdminSessionUser {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
}

export interface AdminSessionPayload {
  accessToken: string
  refreshToken?: string | null
  user: AdminSessionUser
  issuedAt: number
  expiresAt: number
  lastSeenAt: number
}

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64url')

function sign(payloadB64: string): string {
  return createHmac('sha256', requiredEnv('ADMIN_SESSION_SECRET'))
    .update(payloadB64)
    .digest('base64url')
}

export function encodeAdminSession(payload: AdminSessionPayload): string {
  const payloadB64 = base64url(JSON.stringify(payload))
  return `${payloadB64}.${sign(payloadB64)}`
}

export function decodeAdminSession(value: string | undefined): AdminSessionPayload | null {
  if (!value) return null
  const [payloadB64, signature] = value.split('.')
  if (!payloadB64 || !signature) return null
  const expected = sign(payloadB64)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as AdminSessionPayload
    if (typeof payload.expiresAt !== 'number' || typeof payload.lastSeenAt !== 'number') {
      return null
    }
    const now = Date.now()
    if (payload.expiresAt <= now) return null // absolute TTL
    if (payload.lastSeenAt + IDLE_TTL_MS <= now) return null // idle TTL
    return payload
  } catch {
    return null
  }
}

export function newAdminSessionPayload(input: {
  accessToken: string
  refreshToken?: string | null
  user: AdminSessionUser
}): AdminSessionPayload {
  const now = Date.now()
  return {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken ?? null,
    user: input.user,
    issuedAt: now,
    expiresAt: now + ABSOLUTE_TTL_MS,
    lastSeenAt: now,
  }
}

export function touchAdminSession(payload: AdminSessionPayload): AdminSessionPayload {
  return { ...payload, lastSeenAt: Date.now() }
}

export const adminSessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: ABSOLUTE_TTL_MS / 1000,
}

/** OAuth state cookie: signed, 10-minute TTL, binds callback to the sign-in. */
export function encodeOAuthState(returnTo: string): string {
  const payload = { returnTo, nonce: randomBytes(16).toString('base64url'), exp: Date.now() + 10 * 60 * 1000 }
  const payloadB64 = base64url(JSON.stringify(payload))
  return `${payloadB64}.${sign(payloadB64)}`
}

export function decodeOAuthState(value: string | undefined): { returnTo: string } | null {
  if (!value) return null
  const [payloadB64, signature] = value.split('.')
  if (!payloadB64 || !signature) return null
  const expected = sign(payloadB64)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      returnTo: string
      exp: number
    }
    if (payload.exp <= Date.now()) return null
    const returnTo =
      typeof payload.returnTo === 'string' && payload.returnTo.startsWith('/')
        ? payload.returnTo
        : '/'
    return { returnTo }
  } catch {
    return null
  }
}
