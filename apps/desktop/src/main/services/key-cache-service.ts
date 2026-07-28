// Key Cache Service - holds user-owned BYOK credentials from the local
// environment and the main-process Overlay access token.
//
// Owner-funded provider credentials are server-only. This service must never
// retrieve reusable provider or integration keys from Overlay Server.

import { BrowserWindow } from 'electron'
import { safeStorageService } from './security/safe-storage-service'
import { serverProfileService } from './security/server-profile-service'

// Note: dotenv is loaded at the start of main/index.ts before any imports
// so environment variables should be available if set in .env

const PROVIDER_ENV_VARS: Record<APIProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  xai: 'XAI_API_KEY',
  groq: 'GROQ_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  composio: 'COMPOSIO_API_KEY',
  ai_gateway: 'AI_GATEWAY_API_KEY',
  mixpanel: 'MIXPANEL_TOKEN'
}

export type APIProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'groq'
  | 'minimax'
  | 'openrouter'
  | 'composio'
  | 'ai_gateway'
  | 'mixpanel'

interface CachedKey {
  key: string
  fetchedAt: number
}

export class KeyCacheService {
  private keyCache: Map<APIProvider, CachedKey> = new Map()
  private readonly SESSION_DURATION = 4 * 60 * 60 * 1000 // 4 hours
  private accessToken: string | null = null
  private refreshBackoffUntil = 0 // timestamp; don't attempt refresh before this
  private pendingRefreshPromise: Promise<boolean> | null = null // dedup concurrent refreshes
  private unauthorizedRecoveryBlockedUntil = 0
  private readonly UNAUTHORIZED_RECOVERY_COOLDOWN_MS = 60_000
  private forcedSignOutInProgress = false

  // Set the access token after authentication
  setAccessToken(token: string): void {
    this.accessToken = token
    console.log('[KeyCacheService] Access token set')
  }

  // Get the current access token
  getAccessToken(): string | null {
    return this.accessToken
  }

  private getApiBaseUrl(): string {
    return serverProfileService.getActiveOrigin()
  }

  private async refreshAccessToken(): Promise<boolean> {
    // Respect 429 backoff — don't attempt another refresh until the cooldown expires
    if (Date.now() < this.refreshBackoffUntil) {
      const remaining = Math.ceil((this.refreshBackoffUntil - Date.now()) / 1000)
      console.log(`[KeyCacheService] Refresh skipped — rate-limited, retry in ${remaining}s`)
      return false
    }

    const session = safeStorageService.getAuthSession()
    const refreshToken = session?.refreshToken?.trim()
    const userId = session?.user?.id?.trim()

    if (!refreshToken || !userId) {
      return false
    }

    const response = await fetch(`${this.getApiBaseUrl()}/api/auth/native/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        refreshToken,
        userId
      })
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      const errorCode = parseRefreshErrorCode(errorText)

      // Parse 429 rate-limit backoff and store it so we don't hammer the endpoint
      if (response.status === 429) {
        let retrySeconds = 600 // default fallback
        try {
          const parsed = JSON.parse(errorText)
          if (typeof parsed.retryAfterSeconds === 'number') {
            retrySeconds = parsed.retryAfterSeconds
          }
        } catch {
          // response wasn't JSON; use default
        }
        this.refreshBackoffUntil = Date.now() + retrySeconds * 1000
        console.warn(
          `[KeyCacheService] Native refresh rate-limited (429) — backing off for ${retrySeconds}s`
        )
      } else if (response.status === 401 && errorCode === 'invalid_refresh_token') {
        // The server reserves this code for a terminal provider response such
        // as invalid_grant/session revocation. A generic 401 is not enough:
        // older servers collapsed transient WorkOS failures into 401s.
        console.warn('[KeyCacheService] Refresh token is definitively invalid — re-auth required')
        this.forceSignOutForInvalidSession()
      } else {
        console.warn(
          `[KeyCacheService] Native refresh temporarily unavailable (${response.status} ${response.statusText})${errorText ? `: ${errorText.slice(0, 300)}` : ''}; preserving the stored session`
        )
      }
      return false
    }

    const data = (await response.json()) as {
      success?: boolean
      session?: {
        accessToken: string
        refreshToken: string
        user: {
          id: string
          email: string
          firstName?: string
          lastName?: string
          profilePictureUrl?: string
        }
        expiresAt?: number
      }
    }

    if (
      !data.success ||
      !data.session?.accessToken ||
      !data.session?.refreshToken ||
      !data.session.user?.id
    ) {
      return false
    }

    safeStorageService.storeAuthSession(data.session)
    this.accessToken = data.session.accessToken
    console.log('[KeyCacheService] Refreshed the main-process access token')
    return true
  }

  async refreshAccessTokenIfPossible(): Promise<boolean> {
    // Fast path: if we're in a 429 backoff window, skip immediately
    if (Date.now() < this.refreshBackoffUntil) {
      const remaining = Math.ceil((this.refreshBackoffUntil - Date.now()) / 1000)
      console.log(`[KeyCacheService] Refresh skipped — rate-limited, retry in ${remaining}s`)
      return false
    }

    // Deduplicate: if a refresh is already in flight, await it instead of making another call
    if (this.pendingRefreshPromise) {
      console.log('[KeyCacheService] Refresh already in progress — awaiting existing promise')
      return this.pendingRefreshPromise
    }

    this.pendingRefreshPromise = this.refreshAccessToken().finally(() => {
      this.pendingRefreshPromise = null
    })
    return this.pendingRefreshPromise
  }

  async recoverAccessTokenAfterUnauthorized(rejectedAccessToken: string): Promise<boolean> {
    const rejected = rejectedAccessToken.trim()
    if (!rejected) return false

    if (this.accessToken && this.accessToken !== rejected) {
      return true
    }
    if (this.pendingRefreshPromise) {
      return this.pendingRefreshPromise
    }
    if (Date.now() < this.unauthorizedRecoveryBlockedUntil) {
      console.warn('[KeyCacheService] Repeated unauthorized recovery suppressed')
      return false
    }

    this.unauthorizedRecoveryBlockedUntil =
      Date.now() + this.UNAUTHORIZED_RECOVERY_COOLDOWN_MS
    return this.refreshAccessTokenIfPossible()
  }

  markAccessTokenAccepted(accessToken: string): void {
    if (this.accessToken === accessToken) {
      this.unauthorizedRecoveryBlockedUntil = 0
    }
  }

  forceSignOutForInvalidSession(): void {
    if (this.forcedSignOutInProgress) return
    if (!this.accessToken && !safeStorageService.getAuthSession()) return
    this.forcedSignOutInProgress = true
    this.accessToken = null
    this.refreshBackoffUntil = 0
    this.pendingRefreshPromise = null
    this.unauthorizedRecoveryBlockedUntil = 0
    this.clearAllKeys()
    safeStorageService.clearAuthSession()

    // Reset the cached AI Gateway instance so the next session re-fetches its
    // credentials. Dynamic import avoids a circular dependency.
    void import('./ai/gateway-provider')
      .then(({ resetProviders }) => resetProviders())
      .catch((err) =>
        console.warn('[KeyCacheService] Failed to reset providers on force sign-out:', err)
      )
      .finally(() => {
        this.forcedSignOutInProgress = false
      })

    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('auth:force-sign-out', { reason: 'session_expired' })
      }
    })
  }

  // Clear access token on sign out
  clearAccessToken(): void {
    this.accessToken = null
    this.refreshBackoffUntil = 0
    this.pendingRefreshPromise = null
    this.unauthorizedRecoveryBlockedUntil = 0
    this.forcedSignOutInProgress = false
    this.clearAllKeys()
  }

  // Get a user-owned BYOK credential from the local process environment.
  // Hosted credentials are resolved and used only by Overlay Server.
  async getKey(provider: APIProvider): Promise<string | null> {
    const cached = this.keyCache.get(provider)

    // Return cached key if still valid
    if (cached && Date.now() - cached.fetchedAt < this.SESSION_DURATION) {
      return cached.key
    }

    const envVarName = PROVIDER_ENV_VARS[provider]
    const key = process.env[envVarName]?.trim() || null

    if (!key) {
      console.info(
        `[KeyCacheService] No user-owned ${provider} BYOK credential is configured; hosted access must use Overlay Server`
      )
      return null
    }

    // Cache in memory only
    this.keyCache.set(provider, { key, fetchedAt: Date.now() })
    console.log(`[KeyCacheService] Key cached for ${provider}`)

    return key
  }

  // Check if we have a cached key for a provider (without fetching)
  hasKey(provider: APIProvider): boolean {
    const cached = this.keyCache.get(provider)
    if (!cached) return false
    return Date.now() - cached.fetchedAt < this.SESSION_DURATION
  }

  // Load locally configured user-owned BYOK credentials into the in-memory
  // cache. This performs no network requests.
  async loadUserOwnedKeys(): Promise<void> {
    const providers: APIProvider[] = ['ai_gateway', 'groq', 'openrouter', 'composio']

    console.log('[KeyCacheService] Loading user-owned BYOK credentials from local configuration...')

    const results = await Promise.allSettled(
      providers.map(async (provider) => {
        const key = await this.getKey(provider)
        return { provider, key }
      })
    )

    const fetched = results
      .filter(
        (r): r is PromiseFulfilledResult<{ provider: APIProvider; key: string | null }> =>
          r.status === 'fulfilled' && r.value.key !== null
      )
      .map((r) => r.value.provider)

    console.log(
      `[KeyCacheService] Loaded user-owned BYOK credentials for: ${fetched.join(', ') || 'none'}`
    )
  }

  // Get all available keys (providers with valid cached keys)
  getAvailableProviders(): APIProvider[] {
    const available: APIProvider[] = []
    for (const [provider, cached] of this.keyCache) {
      if (Date.now() - cached.fetchedAt < this.SESSION_DURATION) {
        available.push(provider)
      }
    }
    return available
  }

  // Clear all cached keys (called on app quit or sign out)
  clearAllKeys(): void {
    this.keyCache.clear()
    console.log('[KeyCacheService] All cached keys cleared')
  }

  // Invalidate session (on sign out)
  invalidateSession(): void {
    this.accessToken = null
    this.refreshBackoffUntil = 0
    this.pendingRefreshPromise = null
    this.unauthorizedRecoveryBlockedUntil = 0
    this.forcedSignOutInProgress = false
    this.clearAllKeys()
    console.log('[KeyCacheService] Session invalidated')
  }
}

function parseRefreshErrorCode(body: string): string | null {
  if (!body) return null
  try {
    const parsed = JSON.parse(body) as { code?: unknown }
    return typeof parsed.code === 'string' ? parsed.code : null
  } catch {
    return null
  }
}

export const keyCacheService = new KeyCacheService()
