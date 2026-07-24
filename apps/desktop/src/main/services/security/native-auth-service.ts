import { app, shell } from 'electron'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { OverlayServerDiscovery } from '@overlay/api-client'
import {
  safeStorageService,
  type AuthSession,
  type AuthSessionMetadata
} from './safe-storage-service'
import { serverProfileService } from './server-profile-service'
import { readBoundedJson } from './bounded-json-response'

const AUTH_TTL_MS = 10 * 60_000
const AUTH_REQUEST_TIMEOUT_MS = 15_000

type PendingNativeAuth = {
  codeVerifier: string
  serverOrigin: string
  state: string
  startedAt: number
  tokenPath: string
}

let pendingNativeAuth: PendingNativeAuth | null = null

function getConfiguredServerOrigin(): string {
  const url = new URL(serverProfileService.getActiveOrigin())
  const isLocalDevelopment =
    !app.isPackaged &&
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (url.protocol !== 'https:' && !isLocalDevelopment) {
    throw new Error('native_auth_insecure_server_origin')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('native_auth_invalid_server_origin')
  }
  return url.origin
}

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url')
}

function validateDiscovery(value: unknown, expectedOrigin: string): OverlayServerDiscovery {
  if (!value || typeof value !== 'object') throw new Error('native_auth_invalid_discovery')
  const discovery = value as Partial<OverlayServerDiscovery>
  const nativeAuth = discovery.nativeAuth
  if (
    discovery.api?.currentVersion !== 'v1' ||
    !Array.isArray(discovery.api.supportedVersions) ||
    !discovery.api.supportedVersions.includes('v1') ||
    !nativeAuth?.supported ||
    nativeAuth.flow !== 'system_browser_pkce'
  ) {
    throw new Error('native_auth_unsupported_server')
  }
  const browserHandoffPath = nativeAuth.browserHandoffPath ?? '/account'
  for (const path of [
    nativeAuth.authorizationPath,
    browserHandoffPath,
    nativeAuth.tokenPath,
    nativeAuth.refreshPath
  ]) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      throw new Error('native_auth_invalid_discovery_path')
    }
    if (new URL(path, expectedOrigin).origin !== expectedOrigin) {
      throw new Error('native_auth_cross_origin_discovery_path')
    }
  }
  return discovery as OverlayServerDiscovery
}

export async function startNativeSignIn(forceSignIn = false): Promise<void> {
  if (!safeStorageService.isEncryptionAvailable()) {
    throw new Error('native_auth_secure_storage_unavailable')
  }

  const serverOrigin = getConfiguredServerOrigin()
  const discoveryResponse = await fetch(`${serverOrigin}/api/v1/discovery`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS)
  })
  if (!discoveryResponse.ok) throw new Error('native_auth_discovery_failed')
  const discovery = validateDiscovery(await readBoundedJson(discoveryResponse), serverOrigin)

  const codeVerifier = base64Url(randomBytes(48))
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url')
  const state = base64Url(randomBytes(32))

  pendingNativeAuth = {
    codeVerifier,
    serverOrigin,
    state,
    startedAt: Date.now(),
    tokenPath: discovery.nativeAuth.tokenPath
  }

  const handoffUrl = new URL(discovery.nativeAuth.browserHandoffPath ?? '/account', serverOrigin)
  handoffUrl.searchParams.set('desktop_code_challenge', codeChallenge)
  if (forceSignIn) handoffUrl.searchParams.set('force', 'true')

  console.log('[Auth] Opening browser session handoff through configured Overlay Server')
  await shell.openExternal(handoffUrl.toString())
}

export async function completeNativeSignIn(
  code: string,
  returnedState: string
): Promise<AuthSession> {
  const pending = pendingNativeAuth
  pendingNativeAuth = null
  if (!pending || Date.now() - pending.startedAt > AUTH_TTL_MS) {
    throw new Error('native_auth_expired_or_missing_state')
  }
  const expected = Buffer.from(pending.state, 'utf8')
  const actual = Buffer.from(returnedState, 'utf8')
  if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) {
    throw new Error('native_auth_state_mismatch')
  }
  if (typeof code !== 'string' || code.length < 8 || code.length > 4096) {
    throw new Error('native_auth_invalid_code')
  }

  const response = await fetch(new URL(pending.tokenPath, pending.serverOrigin), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code, codeVerifier: pending.codeVerifier }),
    signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error('native_auth_exchange_failed')
  const result = (await readBoundedJson(response, 1024 * 1024)) as {
    success?: unknown
    session?: unknown
  }
  if (result.success !== true || !result.session) throw new Error('native_auth_invalid_exchange')
  const session = result.session as AuthSession
  if (!safeStorageService.storeAuthSession(session)) {
    throw new Error('native_auth_secure_storage_failed')
  }
  const stored = safeStorageService.getAuthSession()
  if (!stored) throw new Error('native_auth_secure_storage_verification_failed')
  return stored
}

export function getNativeAuthState(): AuthSessionMetadata | null {
  return safeStorageService.getAuthSessionMetadata()
}

export function consumeSessionTransferVerifier(serverOrigin: string): string | null {
  const pending = pendingNativeAuth
  pendingNativeAuth = null
  if (!pending || Date.now() - pending.startedAt > AUTH_TTL_MS) return null
  if (new URL(serverOrigin).origin !== pending.serverOrigin) return null
  return pending.codeVerifier
}

export function cancelPendingNativeAuth(): void {
  pendingNativeAuth = null
}
