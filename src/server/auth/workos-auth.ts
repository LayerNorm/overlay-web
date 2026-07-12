import 'server-only'

import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { WorkOS } from '@workos-inc/node'
import { getVerifiedAccessTokenClaims } from '../../../convex/lib/auth'
import {
  decryptSessionCookiePayload,
  encryptSessionCookiePayload,
} from '@/server/auth/session-transfer-crypto'
import {
  logAuthDebug,
  summarizeEnvResolutionForLog,
  summarizeJwtForLog,
  summarizeOpaqueTokenForLog,
  summarizeSessionForLog,
} from '@/server/auth/auth-debug'
import {
  DEFAULT_AUTH_REDIRECT,
  DESKTOP_AUTH_REDIRECT_URI,
  SESSION_TRANSFER_DEEP_LINK_PREFIX,
} from '@/shared/auth/auth-constants'
import { getBaseUrl } from '@/server/web/app-url'
import type { AuthUser, AuthSession } from '@/shared/auth/session-types'
import {
  COOKIE_REFRESH_WITHIN_MS,
  resolveSessionRefreshAction,
  shouldRefreshAccessToken,
} from './workos-token-claims'

export type { AuthUser, AuthSession } from '@/shared/auth/session-types'
export { WorkOSAuthProvider } from './providers/workos-auth-provider'

const isDev = process.env.NODE_ENV === 'development'
const workosApiKey = isDev 
  ? (process.env.DEV_WORKOS_API_KEY || process.env.WORKOS_API_KEY)
  : process.env.WORKOS_API_KEY
const clientId = isDev
  ? (process.env.DEV_WORKOS_CLIENT_ID || process.env.WORKOS_CLIENT_ID || '')
  : (process.env.WORKOS_CLIENT_ID || '')

const SESSION_COOKIE_NAME = 'overlay_session'
const AUTH_STATE_COOKIE_NAME = 'overlay_auth_state'
const SESSION_MAX_AGE = 60 * 60 * 24 * 30
const AUTH_STATE_MAX_AGE = 60 * 10
const EMAIL_VERIFICATION_TICKET_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const MOBILE_AUTH_REDIRECT_PATH = '/auth/mobile-complete'

type AuthorizationState = {
  codeChallenge?: string
  nonce: string
  redirectTo: string
}

type EmailVerificationTicket = {
  email: string
  expiresAt: number
  userId: string
}

logAuthDebug('workos-auth initialized', {
  isDev,
  env: summarizeEnvResolutionForLog(),
})

function getWorkOS(requireApiKey = false): WorkOS {
  if (requireApiKey && !workosApiKey) {
    throw new Error(
      isDev
        ? 'WorkOS API key is not configured. Set DEV_WORKOS_API_KEY or WORKOS_API_KEY for server-side auth.'
        : 'WorkOS API key is not configured. Set WORKOS_API_KEY for server-side auth.'
    )
  }

  if (workosApiKey) {
    return new WorkOS({ apiKey: workosApiKey })
  }

  if (clientId) {
    return new WorkOS({ clientId })
  }

  throw new Error(
    isDev
      ? 'WorkOS is not configured. Set DEV_WORKOS_CLIENT_ID/WORKOS_CLIENT_ID and DEV_WORKOS_API_KEY/WORKOS_API_KEY.'
      : 'WorkOS is not configured. Set WORKOS_CLIENT_ID and WORKOS_API_KEY.'
  )
}

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim()
  if (!secret) {
    throw new Error('SESSION_SECRET is not configured')
  }
  return secret
}

function signPayload(payload: string, secret = getSessionSecret()): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function getSessionVerificationSecrets(): string[] {
  const previous = process.env.SESSION_SECRET_PREVIOUS?.trim()
  return previous && previous !== getSessionSecret() ? [getSessionSecret(), previous] : [getSessionSecret()]
}

function verifySignedCookie(cookieValue: string): string | null {
  const separatorIndex = cookieValue.lastIndexOf('.')
  if (separatorIndex === -1) return null

  const payload = cookieValue.substring(0, separatorIndex)
  const signature = cookieValue.substring(separatorIndex + 1)

  try {
    const sigBuf = Buffer.from(signature, 'hex')
    const matches = getSessionVerificationSecrets().some((secret) => {
      const expectedBuf = Buffer.from(signPayload(payload, secret), 'hex')
      return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)
    })
    if (!matches) return null
  } catch (_error) {
    return null
  }

  return payload
}

function signedValuesMatch(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, 'utf8')
  const rightBuf = Buffer.from(right, 'utf8')
  return leftBuf.length === rightBuf.length && timingSafeEqual(leftBuf, rightBuf)
}

function encodeSignedValue(value: string): string {
  const payload = Buffer.from(value, 'utf8').toString('base64url')
  const signature = signPayload(payload)
  return `${payload}.${signature}`
}

function decodeSignedValue(value: string): string | null {
  const payload = verifySignedCookie(value)
  if (!payload) return null
  try {
    return Buffer.from(payload, 'base64url').toString('utf8')
  } catch (_error) {
    return null
  }
}

async function clearAuthorizationStateCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(AUTH_STATE_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
}

function parseSessionPayload(payload: string): AuthSession {
  const decrypted = decryptSessionCookiePayload(payload)
  return JSON.parse(decrypted) as AuthSession
}

function parseLegacySessionPayload(payload: string): AuthSession {
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')) as AuthSession
}

export { getBaseUrl }

function toAuthUser(user: {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  profilePictureUrl?: string | null
  emailVerified: boolean
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName || undefined,
    lastName: user.lastName || undefined,
    profilePictureUrl: user.profilePictureUrl || undefined,
    emailVerified: user.emailVerified,
  }
}

export function normalizeAuthRedirect(redirectUri?: string | null): string | null {
  if (redirectUri == null) {
    return DEFAULT_AUTH_REDIRECT
  }

  const trimmed = redirectUri.trim()
  if (!trimmed) {
    return DEFAULT_AUTH_REDIRECT
  }

  if (trimmed === DESKTOP_AUTH_REDIRECT_URI || trimmed.startsWith(`${SESSION_TRANSFER_DEEP_LINK_PREFIX}?`)) {
    return MOBILE_AUTH_REDIRECT_PATH
  }

  if (trimmed.startsWith('/')) {
    return trimmed.startsWith('//') ? null : trimmed
  }

  try {
    const baseUrl = new URL(getBaseUrl())
    const candidate = new URL(trimmed)
    if (candidate.origin !== baseUrl.origin) {
      return null
    }
    return `${candidate.pathname}${candidate.search}${candidate.hash}` || DEFAULT_AUTH_REDIRECT
  } catch (_error) {
    return null
  }
}

export function createEmailVerificationTicket(args: {
  email: string
  userId: string
}): string {
  const ticket: EmailVerificationTicket = {
    email: args.email.trim(),
    expiresAt: Date.now() + EMAIL_VERIFICATION_TICKET_MAX_AGE_MS,
    userId: args.userId.trim(),
  }
  return encodeSignedValue(JSON.stringify(ticket))
}

export function readEmailVerificationTicket(
  value: string | null | undefined,
): EmailVerificationTicket | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  const decoded = decodeSignedValue(trimmed)
  if (!decoded) return null

  try {
    const parsed = JSON.parse(decoded) as Partial<EmailVerificationTicket>
    if (typeof parsed.userId !== 'string' || !parsed.userId.trim()) return null
    if (typeof parsed.email !== 'string' || !parsed.email.trim()) return null
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt < Date.now()) return null

    return {
      email: parsed.email.trim(),
      expiresAt: parsed.expiresAt,
      userId: parsed.userId.trim(),
    }
  } catch (_error) {
    return null
  }
}

export function normalizeCodeChallenge(codeChallenge?: string | null): string | null {
  if (codeChallenge == null) return null
  const trimmed = codeChallenge.trim()
  if (!trimmed) return null
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(trimmed)) {
    return null
  }
  return trimmed
}

async function createAuthorizationState(params: {
  redirectTo: string
  codeChallenge?: string | null
}): Promise<string> {
  const state: AuthorizationState = {
    nonce: crypto.randomUUID(),
    redirectTo: params.redirectTo,
    ...(params.codeChallenge ? { codeChallenge: params.codeChallenge } : {}),
  }
  const encoded = encodeSignedValue(JSON.stringify(state))
  const cookieStore = await cookies()
  cookieStore.set(AUTH_STATE_COOKIE_NAME, encoded, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: AUTH_STATE_MAX_AGE,
    path: '/',
  })
  return encoded
}

export async function consumeAuthorizationState(
  encodedState: string | null | undefined,
): Promise<AuthorizationState | null> {
  const trimmed = encodedState?.trim()
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(AUTH_STATE_COOKIE_NAME)?.value

  await clearAuthorizationStateCookie()

  if (!trimmed || !cookieValue || !signedValuesMatch(trimmed, cookieValue)) {
    return null
  }

  const decoded = decodeSignedValue(trimmed)
  if (!decoded) return null

  try {
    const parsed = JSON.parse(decoded) as Partial<AuthorizationState>
    if (typeof parsed.nonce !== 'string' || !parsed.nonce.trim()) return null
    if (typeof parsed.redirectTo !== 'string' || !parsed.redirectTo.trim()) return null
    if (parsed.codeChallenge !== undefined && normalizeCodeChallenge(parsed.codeChallenge) === null) {
      return null
    }
    return {
      nonce: parsed.nonce,
      redirectTo: parsed.redirectTo,
      ...(parsed.codeChallenge ? { codeChallenge: parsed.codeChallenge } : {}),
    }
  } catch (_error) {
    return null
  }
}

// Generate authorization URL for SSO providers
export async function getAuthorizationUrl(
  provider: 'GoogleOAuth' | 'AppleOAuth' | 'MicrosoftOAuth',
  options: {
    redirectUri?: string
    forceSignIn?: boolean
    codeChallenge?: string | null
  } = {},
): Promise<string> {
  if (!clientId) {
    throw new Error('WorkOS client ID is not configured')
  }

  const workos = getWorkOS()
  const baseRedirectUri = `${getBaseUrl()}/api/auth/callback`
  const normalizedRedirectUri = normalizeAuthRedirect(options.redirectUri)
  if (options.redirectUri && normalizedRedirectUri === null) {
    throw new Error('Invalid redirect URI')
  }
  const normalizedCodeChallenge = normalizeCodeChallenge(options.codeChallenge)
  if (normalizedRedirectUri === MOBILE_AUTH_REDIRECT_PATH && !normalizedCodeChallenge) {
    throw new Error('Native authentication requires a valid codeChallenge')
  }

  const state = await createAuthorizationState({
    redirectTo: normalizedRedirectUri ?? DEFAULT_AUTH_REDIRECT,
    codeChallenge: normalizedCodeChallenge,
  })
  // Build authorization URL options
  const authOptions: Parameters<typeof workos.userManagement.getAuthorizationUrl>[0] = {
    provider,
    clientId,
    redirectUri: baseRedirectUri,
    state,
  }
  
  // Force sign-in screen when coming from desktop app
  // This prevents auto-redirecting if the user has an existing OAuth session
  if (options.forceSignIn) {
    authOptions.screenHint = 'sign-in'
  }
  
  let authorizationUrl: string
  try {
    authorizationUrl = workos.userManagement.getAuthorizationUrl(authOptions)
  } catch (_error) {
    // Fallback: try without screenHint if it causes issues
    delete authOptions.screenHint
    authorizationUrl = workos.userManagement.getAuthorizationUrl(authOptions)

    if (options.forceSignIn) {
      const url = new URL(authorizationUrl)
      url.searchParams.set('prompt', 'login')
      authorizationUrl = url.toString()
    }
  }

  return authorizationUrl
}

export async function getNativeAuthorizationUrl(
  provider: 'GoogleOAuth' | 'AppleOAuth' | 'MicrosoftOAuth' | 'authkit',
  options: {
    redirectUri: string
    codeChallenge: string
    state: string
    forceSignIn?: boolean
  },
): Promise<string> {
  if (!clientId) {
    throw new Error('WorkOS client ID is not configured')
  }

  const normalizedCodeChallenge = normalizeCodeChallenge(options.codeChallenge)
  if (!normalizedCodeChallenge) {
    throw new Error('Native authentication requires a valid codeChallenge')
  }

  const workos = getWorkOS()
  return workos.userManagement.getAuthorizationUrl({
    provider,
    clientId,
    redirectUri: options.redirectUri,
    state: options.state,
    codeChallenge: normalizedCodeChallenge,
    codeChallengeMethod: 'S256',
    ...(options.forceSignIn ? { prompt: 'login' } : {}),
  })
}

export async function authenticateNativeWithCode(
  code: string,
  codeVerifier: string,
): Promise<AuthSession> {
  if (!clientId) {
    throw new Error('WorkOS client ID is not configured')
  }

  const workos = getWorkOS(true)
  const response = await workos.userManagement.authenticateWithCode({
    clientId,
    code,
    codeVerifier,
  })

  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    user: toAuthUser(response.user),
    expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
  }
}

// Authenticate with email and password
export async function authenticateWithPassword(
  email: string,
  password: string
): Promise<{ success: boolean; user?: AuthUser; error?: string; pendingEmailVerification?: boolean }> {
  try {
    const workos = getWorkOS(true)
    const response = await workos.userManagement.authenticateWithPassword({
      clientId,
      email,
      password,
    })

    const user = toAuthUser(response.user)

    // Create session
    await createSession({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      user,
      expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
    })

    return { success: true, user }
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string }
    if (err.code === 'email_verification_required') {
      return { success: false, pendingEmailVerification: true, error: 'Please verify your email before signing in.' }
    }
    return { success: false, error: err.message || 'Authentication failed' }
  }
}

// Create a new user with email and password
export async function createUser(
  email: string,
  password: string,
  firstName?: string,
  lastName?: string
): Promise<{ success: boolean; user?: AuthUser; error?: string; pendingEmailVerification?: boolean; verificationTicket?: string }> {
  try {
    const workos = getWorkOS(true)
    const user = await workos.userManagement.createUser({
      email,
      password,
      firstName,
      lastName,
      emailVerified: false,
    })

    // Send verification email
    await workos.userManagement.sendVerificationEmail({
      userId: user.id,
    })

    return {
      success: true,
      pendingEmailVerification: true,
      verificationTicket: createEmailVerificationTicket({
        email: user.email,
        userId: user.id,
      }),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        profilePictureUrl: user.profilePictureUrl || undefined,
        emailVerified: user.emailVerified,
      },
    }
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string }
    if (err.code === 'user_already_exists') {
      return { success: false, error: 'An account with this email already exists.' }
    }
    return { success: false, error: err.message || 'Failed to create account' }
  }
}

// Handle OAuth callback - exchange code for session
export async function handleCallback(
  code: string
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  try {
    logAuthDebug('handleCallback start', {
      codeLength: code.length,
      env: summarizeEnvResolutionForLog(),
    })
    const workos = getWorkOS(true)
    const response = await workos.userManagement.authenticateWithCode({
      clientId,
      code,
    })

    const user = toAuthUser(response.user)

    logAuthDebug('handleCallback authenticateWithCode success', {
      responseUserId: response.user.id,
      user,
      accessToken: summarizeJwtForLog(response.accessToken),
      refreshToken: summarizeOpaqueTokenForLog(response.refreshToken),
    })

    // Create session
    await createSession({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      user,
      expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
    })

    return { success: true, user }
  } catch (error: unknown) {
    const err = error as { message?: string }
    logAuthDebug('handleCallback error', {
      message: err.message || 'Authentication failed',
    })
    return { success: false, error: err.message || 'Authentication failed' }
  }
}

// Send password reset email
export async function sendPasswordResetEmail(
  email: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const workos = getWorkOS(true)
    // WorkOS User Management API - create password reset challenge
    await workos.userManagement.createPasswordReset({
      email,
    })
    return { success: true }
  } catch (_error) {
    // Don't reveal if email exists or not for security
    return { success: true } // Always return success to prevent email enumeration
  }
}

// Reset password with token
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const workos = getWorkOS(true)
    await workos.userManagement.resetPassword({
      token,
      newPassword,
    })
    return { success: true }
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string }
    if (err.code === 'password_reset_token_expired') {
      return { success: false, error: 'Reset link has expired. Please request a new one.' }
    }
    return { success: false, error: err.message || 'Failed to reset password' }
  }
}

// Verify email with code
export async function verifyEmail(
  userId: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const workos = getWorkOS(true)
    await workos.userManagement.verifyEmail({
      userId,
      code,
    })
    return { success: true }
  } catch (error: unknown) {
    const err = error as { message?: string }
    return { success: false, error: err.message || 'Failed to verify email' }
  }
}

// Resend verification email
export async function resendVerificationEmail(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const workos = getWorkOS(true)
    await workos.userManagement.sendVerificationEmail({
      userId,
    })
    return { success: true }
  } catch (error: unknown) {
    const err = error as { message?: string }
    return { success: false, error: err.message || 'Failed to send verification email' }
  }
}

export async function createSession(session: AuthSession): Promise<void> {
  const cookieStore = await cookies()
  const payload = encryptSessionCookiePayload(JSON.stringify(session))
  const signature = signPayload(payload)
  const signedCookie = `${payload}.${signature}`
  logAuthDebug('createSession', summarizeSessionForLog(session))
  
  cookieStore.set(SESSION_COOKIE_NAME, signedCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  })
}

const refreshInFlightByUserId = new Map<string, Promise<AuthSession | null>>()

async function rotateAccessTokenWithWorkOs(session: AuthSession): Promise<AuthSession | null> {
  try {
    logAuthDebug('rotateAccessTokenWithWorkOs start', summarizeSessionForLog(session))
    const workos = getWorkOS(true)
    const response = await workos.userManagement.authenticateWithRefreshToken({
      clientId,
      refreshToken: session.refreshToken,
    })
    const newSession: AuthSession = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      user: toAuthUser(response.user),
      expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
    }
    await createSession(newSession)
    logAuthDebug('rotateAccessTokenWithWorkOs success', {
      previousSession: summarizeSessionForLog(session),
      refreshedSession: summarizeSessionForLog(newSession),
    })
    return newSession
  } catch (error) {
    logAuthDebug('rotateAccessTokenWithWorkOs error', {
      session: summarizeSessionForLog(session),
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function refreshAccessTokenDeduped(session: AuthSession): Promise<AuthSession | null> {
  const key = session.user.id
  const existing = refreshInFlightByUserId.get(key)
  if (existing) {
    return existing
  }
  const promise = rotateAccessTokenWithWorkOs(session).finally(() => {
    refreshInFlightByUserId.delete(key)
  })
  refreshInFlightByUserId.set(key, promise)
  return promise
}

async function locallyExtendSessionCookie(session: AuthSession): Promise<AuthSession> {
  const extendedSession: AuthSession = {
    ...session,
    expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
  }
  await createSession(extendedSession)
  return extendedSession
}

export async function getSession(
  options: { allowRefresh?: boolean } = {},
): Promise<AuthSession | null> {
  const allowRefresh = options.allowRefresh === true
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)
  logAuthDebug('getSession start', {
    allowRefresh,
    hasCookie: Boolean(sessionCookie),
    cookieLength: sessionCookie?.value.length ?? 0,
  })
  
  if (!sessionCookie) {
    logAuthDebug('getSession missing cookie')
    return null
  }

  try {
    const payload = verifySignedCookie(sessionCookie.value)
    if (!payload) {
      logAuthDebug('getSession invalid signed cookie', {
        cookieLength: sessionCookie.value.length,
      })
      if (allowRefresh) await clearSession()
      return null
    }

    let session: AuthSession
    let migratedLegacyCookie = false
    try {
      session = parseSessionPayload(payload)
    } catch (_error) {
      session = parseLegacySessionPayload(payload)
      migratedLegacyCookie = true
    }

    if (migratedLegacyCookie && allowRefresh) {
      await createSession(session)
      logAuthDebug('getSession migrated legacy cookie', summarizeSessionForLog(session))
    }

    logAuthDebug('getSession parsed session', summarizeSessionForLog(session))
    if (session.expiresAt < Date.now()) {
      logAuthDebug('getSession expired session', summarizeSessionForLog(session))
      if (allowRefresh) await clearSession()
      return null
    }

    const claims = await getVerifiedAccessTokenClaims(session.accessToken)
    const accessTokenMatchesSessionUser = claims?.sub === session.user.id
    const needsJwtRefresh = !claims || shouldRefreshAccessToken(session.accessToken)
    const cookieExpiringSoon = session.expiresAt <= Date.now() + COOKIE_REFRESH_WITHIN_MS
    const refreshAction = resolveSessionRefreshAction({
      accessTokenMatchesSessionUser,
      allowRefresh,
      cookieExpiringSoon,
      needsJwtRefresh,
    })
    logAuthDebug('getSession refresh evaluation', {
      accessTokenMatchesSessionUser,
      allowRefresh,
      hasVerifiedClaims: Boolean(claims),
      needsJwtRefresh,
      cookieExpiringSoon,
      refreshAction,
      accessToken: summarizeJwtForLog(session.accessToken),
      session: summarizeSessionForLog(session),
    })

    if (refreshAction === 'reject') {
      logAuthDebug('getSession read-only validation rejected session', summarizeSessionForLog(session))
      return null
    }

    if (refreshAction === 'refresh-token') {
      if (!workosApiKey || !clientId) {
        logAuthDebug('getSession cannot refresh access token due to missing WorkOS config', {
          env: summarizeEnvResolutionForLog(),
          session: summarizeSessionForLog(session),
        })
        await clearSession()
        return null
      }
      const refreshed = await refreshAccessTokenDeduped(session)
      if (!refreshed) {
        logAuthDebug('getSession refresh failed for invalid access token; clearing session', summarizeSessionForLog(session))
        await clearSession()
        return null
      }
      logAuthDebug('getSession returned refreshed session', summarizeSessionForLog(refreshed))
      return refreshed
    }

    if (refreshAction === 'extend-cookie') {
      const extended = await locallyExtendSessionCookie(session)
      logAuthDebug('getSession locally extended cookie-backed session', summarizeSessionForLog(extended))
      return extended
    }

    logAuthDebug('getSession returning existing session', summarizeSessionForLog(session))
    return session
  } catch (error) {
    logAuthDebug('getSession error', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}

/**
 * Returns a session, rotating the WorkOS access token when it is expired/near expiry
 * or when the cookie session is within 24h of expiry (see getSession).
 */
export async function refreshSessionIfNeeded(): Promise<AuthSession | null> {
  return getSession({ allowRefresh: true })
}

export async function refreshSessionFromStoredSession(
  session: AuthSession,
): Promise<AuthSession | null> {
  logAuthDebug('refreshSessionFromStoredSession start', summarizeSessionForLog(session))
  const refreshed = await refreshSessionFromRefreshToken(session.refreshToken, session.user.id)
  if (!refreshed) {
    logAuthDebug('refreshSessionFromStoredSession failed', summarizeSessionForLog(session))
    return null
  }
  await createSession(refreshed)
  logAuthDebug('refreshSessionFromStoredSession success', summarizeSessionForLog(refreshed))
  return refreshed
}

export async function refreshSessionFromRefreshToken(
  refreshToken: string,
  expectedUserId?: string
): Promise<AuthSession | null> {
  if (!refreshToken) {
    logAuthDebug('refreshSessionFromRefreshToken missing refresh token', {
      expectedUserId: expectedUserId ?? null,
    })
    return null
  }

  try {
    logAuthDebug('refreshSessionFromRefreshToken start', {
      expectedUserId: expectedUserId ?? null,
      refreshToken: summarizeOpaqueTokenForLog(refreshToken),
      env: summarizeEnvResolutionForLog(),
    })
    const workos = getWorkOS(true)
    const response = await workos.userManagement.authenticateWithRefreshToken({
      clientId,
      refreshToken,
    })

    logAuthDebug('refreshSessionFromRefreshToken response', {
      expectedUserId: expectedUserId ?? null,
      responseUserId: response.user.id,
      accessToken: summarizeJwtForLog(response.accessToken),
      refreshToken: summarizeOpaqueTokenForLog(response.refreshToken),
    })

    if (expectedUserId && response.user.id !== expectedUserId) {
      logAuthDebug('refreshSessionFromRefreshToken user mismatch', {
        expectedUserId,
        responseUserId: response.user.id,
      })
      return null
    }

    return {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      user: toAuthUser(response.user),
      expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
    }
  } catch (error) {
    logAuthDebug('refreshSessionFromRefreshToken error', {
      expectedUserId: expectedUserId ?? null,
      refreshToken: summarizeOpaqueTokenForLog(refreshToken),
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
