import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { AUTH_BASE_URL } from './appConfig'

const AUTH_STORAGE_KEY = 'overlay-auth-session'
const PKCE_VERIFIER_STORAGE_KEY = 'overlay-native-pkce-verifier'
const NATIVE_AUTH_PENDING_STORAGE_KEY = 'overlay-native-auth-pending'

const PKCE_VERIFIER_CHARSET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

const FETCH_TIMEOUT_MS = 10_000

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    console.warn('[Auth] fetchWithTimeout: timed out after', FETCH_TIMEOUT_MS, 'ms for', url)
    controller.abort()
  }, FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function base64ToBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256Base64Url(input: string): Promise<string> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  )
  return base64ToBase64Url(hash)
}

async function generateCodeVerifier(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(64)
  let out = ''
  const len = PKCE_VERIFIER_CHARSET.length
  for (let i = 0; i < bytes.length; i++) {
    out += PKCE_VERIFIER_CHARSET[bytes[i]! % len]
  }
  return out
}

export interface AuthUser {
  id: string
  email: string
  firstName?: string
  lastName?: string
  profilePictureUrl?: string
  emailVerified?: boolean
}

export interface AuthSession {
  accessToken: string
  refreshToken: string
  user: AuthUser
  expiresAt?: number
}

interface TransferResponse {
  userId: string
  email: string
  firstName?: string
  lastName?: string
  profilePictureUrl?: string
  accessToken: string
  refreshToken: string
  expiresAt?: number
}

interface NativeRefreshResponse {
  success: boolean
  session?: AuthSession
  error?: string
}

interface NativeAuthorizeResponse {
  authorizationUrl: string
  error?: string
}

interface NativeExchangeResponse {
  success: boolean
  session?: AuthSession
  error?: string
}

interface PendingNativeAuthRequest {
  purpose?: 'account-deletion'
  codeVerifier: string
  state: string
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  console.log('[Auth] loadAuthSession: reading from SecureStore')
  try {
    const stored = await SecureStore.getItemAsync(AUTH_STORAGE_KEY)
    if (!stored) {
      console.log('[Auth] loadAuthSession: no stored session found')
      return null
    }

    const session = JSON.parse(stored) as AuthSession
    console.log('[Auth] loadAuthSession: found session for user', session.user?.id)
    return session
  } catch (e) {
    console.warn('[Auth] loadAuthSession: failed to parse stored session', e)
    return null
  }
}

let sessionWrite: Promise<void> = Promise.resolve()

function serializeSessionWrite(write: () => Promise<void>): Promise<void> {
  const request = sessionWrite.then(write)
  sessionWrite = request.catch(() => undefined)
  return request
}

export function saveAuthSession(session: AuthSession): Promise<void> {
  return serializeSessionWrite(() => SecureStore.setItemAsync(AUTH_STORAGE_KEY, JSON.stringify(session)))
}

export function saveRefreshedAuthSession(session: AuthSession, previous: AuthSession): Promise<void> {
  return serializeSessionWrite(async () => {
    const current = await loadAuthSession()
    if (current?.user.id === session.user.id && current.accessToken === session.accessToken) return
    if (session.user.id !== previous.user.id || current?.user.id !== previous.user.id || current.refreshToken !== previous.refreshToken) {
      throw new Error('The stored session changed during refresh.')
    }
    await SecureStore.setItemAsync(AUTH_STORAGE_KEY, JSON.stringify(session))
  })
}

export async function clearAuthSession(): Promise<void> {
  await serializeSessionWrite(() => SecureStore.deleteItemAsync(AUTH_STORAGE_KEY))
  try {
    await SecureStore.deleteItemAsync(PKCE_VERIFIER_STORAGE_KEY)
    await SecureStore.deleteItemAsync(NATIVE_AUTH_PENDING_STORAGE_KEY)
  } catch {
    // ignore if missing
  }
}

/**
 * Hosted auth for mobile requires PKCE: we send codeChallenge on the sign-in URL,
 * store code_verifier locally, and send the verifier when redeeming overlay:// transfer tokens.
 */
export async function clearPkceVerifier(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PKCE_VERIFIER_STORAGE_KEY)
    await SecureStore.deleteItemAsync(NATIVE_AUTH_PENDING_STORAGE_KEY)
    console.log('[Auth] clearPkceVerifier: cleared handoff state')
  } catch {
    // ignore if missing
  }
}

export async function buildCustomAuthUrl(
  mode: 'sign-in' | 'sign-up',
  options: { forceLogin?: boolean } = {},
): Promise<string> {
  console.log('[Auth] buildCustomAuthUrl: mode=%s forceLogin=%s AUTH_BASE_URL=%s', mode, options.forceLogin, AUTH_BASE_URL)

  // Reuse an existing verifier if one is already stored — this handles the case
  // where the app reloaded or crashed mid-flow and buildCustomAuthUrl is called
  // again. Overwriting the verifier would break the in-progress PKCE exchange.
  let verifier = await SecureStore.getItemAsync(PKCE_VERIFIER_STORAGE_KEY)
  if (verifier) {
    console.log('[Auth] buildCustomAuthUrl: reusing existing PKCE verifier (app reloaded mid-flow)')
  } else {
    verifier = await generateCodeVerifier()
    await SecureStore.setItemAsync(PKCE_VERIFIER_STORAGE_KEY, verifier)
    console.log('[Auth] buildCustomAuthUrl: new PKCE verifier stored')
  }

  const codeChallenge = await sha256Base64Url(verifier)
  console.log('[Auth] buildCustomAuthUrl: codeChallenge length=%d', codeChallenge.length)

  const authUrl = new URL(`${AUTH_BASE_URL}${mode === 'sign-up' ? '/auth/sign-up' : '/auth/sign-in'}`)
  authUrl.searchParams.set('redirect', '/auth/mobile-complete')
  authUrl.searchParams.set('codeChallenge', codeChallenge)

  if (options.forceLogin && mode === 'sign-in') {
    authUrl.searchParams.set('force', 'true')
  }

  return authUrl.toString()
}

export type NativeAuthProvider = 'GoogleOAuth' | 'AppleOAuth' | 'MicrosoftOAuth' | 'authkit'

export async function buildNativeAuthRequest(args: {
  provider: NativeAuthProvider
  redirectUri: string
  forceSignIn?: boolean
  purpose?: 'account-deletion'
}): Promise<{ authorizationUrl: string; codeVerifier: string; state: string }> {
  const codeVerifier = await generateCodeVerifier()
  const codeChallenge = await sha256Base64Url(codeVerifier)
  const state = base64ToBase64Url(
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${codeVerifier}:${Date.now()}:${Math.random()}`,
      { encoding: Crypto.CryptoEncoding.BASE64 },
    ),
  )

  const response = await fetchWithTimeout(`${AUTH_BASE_URL}/api/auth/native/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: args.provider,
      redirectUri: args.redirectUri,
      codeChallenge,
      state,
      forceSignIn: args.forceSignIn === true,
    }),
  })

  const data = (await response.json().catch(() => ({}))) as NativeAuthorizeResponse
  if (!response.ok || !data.authorizationUrl) {
    throw new Error(data.error || `Native authorization failed with status ${response.status}`)
  }

  await SecureStore.setItemAsync(
    NATIVE_AUTH_PENDING_STORAGE_KEY,
    JSON.stringify({ codeVerifier, state, purpose: args.purpose } satisfies PendingNativeAuthRequest),
  )

  return { authorizationUrl: data.authorizationUrl, codeVerifier, state }
}

export async function exchangeNativeAuthCode(args: {
  code: string
  codeVerifier: string
}): Promise<AuthSession> {
  const response = await fetchWithTimeout(`${AUTH_BASE_URL}/api/auth/native/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: args.code,
      codeVerifier: args.codeVerifier,
    }),
  })

  const data = (await response.json().catch(() => ({}))) as NativeExchangeResponse
  if (!response.ok || !data.session) {
    throw new Error(data.error || `Native session exchange failed with status ${response.status}`)
  }

  return data.session
}

export async function completeNativeAuthCallback(callbackUrl: string): Promise<AuthSession | null> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(callbackUrl)
  } catch {
    return null
  }

  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.hostname !== 'www.getoverlay.io' ||
    parsedUrl.pathname !== '/auth/native/callback'
  ) {
    return null
  }

  const error = parsedUrl.searchParams.get('error')
  const pendingPurpose = await SecureStore.getItemAsync(NATIVE_AUTH_PENDING_STORAGE_KEY)
  let interruptedDeletion = false
  try {
    interruptedDeletion = Boolean(pendingPurpose && (JSON.parse(pendingPurpose) as PendingNativeAuthRequest).purpose === 'account-deletion')
  } catch {}
  if (interruptedDeletion) {
    await SecureStore.deleteItemAsync(NATIVE_AUTH_PENDING_STORAGE_KEY)
    return null
  }
  if (error) {
    throw new Error(parsedUrl.searchParams.get('error_description') || error)
  }

  const code = parsedUrl.searchParams.get('code')
  const state = parsedUrl.searchParams.get('state')
  if (!code || !state) {
    throw new Error('No authorization code was returned.')
  }

  const pendingJson = await SecureStore.getItemAsync(NATIVE_AUTH_PENDING_STORAGE_KEY)
  if (!pendingJson) {
    throw new Error('No pending sign-in was found. Start sign-in from Overlay again.')
  }

  let pending: PendingNativeAuthRequest
  try {
    pending = JSON.parse(pendingJson) as PendingNativeAuthRequest
  } catch {
    await SecureStore.deleteItemAsync(NATIVE_AUTH_PENDING_STORAGE_KEY)
    throw new Error('Pending sign-in state was corrupted. Start sign-in from Overlay again.')
  }

  if (state !== pending.state) {
    throw new Error('Authentication state did not match. Try signing in again.')
  }

  const session = await exchangeNativeAuthCode({
    code,
    codeVerifier: pending.codeVerifier,
  })

  await SecureStore.deleteItemAsync(NATIVE_AUTH_PENDING_STORAGE_KEY)
  return session
}

export function getAccountUrl(): string {
  return `${AUTH_BASE_URL}/account`
}

export function extractTransferToken(url: string): string | null {
  console.log('[Auth] extractTransferToken: incoming URL received')
  try {
    const parsedUrl = new URL(url)
    const path = parsedUrl.hostname || parsedUrl.pathname.replace(/^\/+/, '')
    console.log('[Auth] extractTransferToken: scheme=%s hostname=%s pathname=%s path=%s', parsedUrl.protocol, parsedUrl.hostname, parsedUrl.pathname, path)

    if (path === 'auth' && parsedUrl.pathname.includes('/transfer')) {
      const token = parsedUrl.searchParams.get('token')
      console.log('[Auth] extractTransferToken: token found, length=%d', token?.length ?? 0)
      return token
    }

    console.log('[Auth] extractTransferToken: URL did not match auth/transfer pattern')
    return null
  } catch (e) {
    console.warn('[Auth] extractTransferToken: failed to parse URL', e)
    return null
  }
}

export async function consumeTransferToken(token: string): Promise<AuthSession> {
  console.log('[Auth] consumeTransferToken: exchanging token, length=%d', token.length)
  const codeVerifier = await SecureStore.getItemAsync(PKCE_VERIFIER_STORAGE_KEY)
  if (!codeVerifier?.trim()) {
    console.error('[Auth] consumeTransferToken: PKCE verifier missing from SecureStore')
    throw new Error('Missing PKCE verifier — open Sign in from the app again and complete auth in one session.')
  }
  console.log('[Auth] consumeTransferToken: PKCE verifier found, length=%d', codeVerifier.trim().length)

  const endpoint = `${AUTH_BASE_URL}/api/auth/desktop-link?token=${encodeURIComponent(token)}`
  console.log('[Auth] consumeTransferToken: POST to desktop-link endpoint')
  const response = await fetchWithTimeout(endpoint, {
    headers: {
      'x-overlay-code-verifier': codeVerifier.trim(),
    },
  })

  console.log('[Auth] consumeTransferToken: response status=%d ok=%s', response.status, response.ok)
  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Auth] consumeTransferToken: failed -', response.status, errorText)
    throw new Error(`Session transfer failed: ${response.status} ${errorText}`)
  }

  try {
    await SecureStore.deleteItemAsync(PKCE_VERIFIER_STORAGE_KEY)
  } catch {
    // ignore
  }

  const data = (await response.json()) as TransferResponse
  console.log('[Auth] consumeTransferToken: success, userId=%s expiresAt=%s', data.userId, data.expiresAt ?? 'none')

  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
    user: {
      id: data.userId,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      profilePictureUrl: data.profilePictureUrl
    }
  }
}

const refreshFlights = new Map<string, Promise<AuthSession>>()

export function refreshAuthSession(session: AuthSession): Promise<AuthSession> {
  const key = `${session.user.id}:${session.refreshToken}`
  const pending = refreshFlights.get(key)
  if (pending) return pending
  const request = requestRefreshedAuthSession(session)
  refreshFlights.set(key, request)
  void request.finally(() => { if (refreshFlights.get(key) === request) refreshFlights.delete(key) }).catch(() => undefined)
  return request
}

async function requestRefreshedAuthSession(session: AuthSession): Promise<AuthSession> {
  console.log('[Auth] refreshAuthSession: refreshing for user=%s', session.user?.id)
  const response = await fetchWithTimeout(`${AUTH_BASE_URL}/api/auth/native/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      refreshToken: session.refreshToken,
      user: session.user
    })
  })

  console.log('[Auth] refreshAuthSession: response status=%d ok=%s', response.status, response.ok)
  const data = (await response.json().catch(() => ({}))) as NativeRefreshResponse

  if (!response.ok || !data.session) {
    console.error('[Auth] refreshAuthSession: failed -', data.error ?? `status ${response.status}`)
    throw new Error(data.error || `Session refresh failed with status ${response.status}`)
  }

  console.log('[Auth] refreshAuthSession: success')
  return data.session
}
