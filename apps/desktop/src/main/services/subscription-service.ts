/**
 * Subscription Service
 *
 * Manages user entitlements, usage tracking, and enforcement
 * Reads authoritative entitlements from the app server and caches them for offline UX.
 * Local usage is advisory only; hosted usage is reserved and finalized by the server.
 */

import { app, BrowserWindow } from 'electron'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'path'
import { createHmac } from 'node:crypto'
import { isPremiumModel, calculateTokenCost } from './model-pricing'
import { keyCacheService } from './key-cache-service'
import { serverProfileService } from './security/server-profile-service'

// ============ TYPES ============

export type SubscriptionTier = 'free' | 'pro' | 'max'

export interface UserEntitlements {
  tier: SubscriptionTier
  planKind?: 'free' | 'paid'
  planAmountCents?: number
  creditsUsed: number // CENTS spent this billing period
  creditsTotal: number // 1500 cents (pro) or 9000 cents (max)
  budgetUsedCents?: number
  budgetTotalCents?: number
  budgetRemainingCents?: number
  overlayStorageBytesUsed: number
  overlayStorageBytesLimit: number
  dailyUsage: { ask: number; write: number; agent: number }
  dailyLimits: { ask: number; write: number; agent: number }
  transcriptionSecondsUsed: number
  transcriptionSecondsLimit: number
  localTranscriptionEnabled: boolean // Only Pro/Max
  resetAt: string // ISO date for daily reset
  billingPeriodEnd: string // ISO date for billing cycle end
  lastSyncedAt: number // Unix timestamp
}

export interface UsageEvent {
  type: 'ask' | 'write' | 'agent' | 'embedding' | 'transcription'
  modelId?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  cost: number
  timestamp: number
}

export interface ActionCheckResult {
  allowed: boolean
  reason?: string
}

// ============ DEFAULTS ============

// Credits are stored in CENTS for simpler math (Pro: 1500 cents = $15, Max: 9000 cents = $90)
// This makes calculations cleaner: cost in cents, credits in cents
const TIER_DEFAULTS: Record<SubscriptionTier, Omit<UserEntitlements, 'lastSyncedAt'>> = {
  free: {
    tier: 'free',
    planKind: 'free',
    planAmountCents: 0,
    creditsUsed: 0,
    creditsTotal: 0,
    budgetUsedCents: 0,
    budgetTotalCents: 0,
    budgetRemainingCents: 0,
    overlayStorageBytesUsed: 0,
    overlayStorageBytesLimit: 0,
    dailyUsage: { ask: 0, write: 0, agent: 0 },
    dailyLimits: { ask: 15, write: 15, agent: 15 }, // Combined limit of 15 total per WEEK (enforced in canPerformAction)
    transcriptionSecondsUsed: 0,
    transcriptionSecondsLimit: 600, // 10 minutes per week
    localTranscriptionEnabled: false, // Free tier: cloud only
    resetAt: '',
    billingPeriodEnd: ''
  },
  pro: {
    tier: 'pro',
    planKind: 'paid',
    planAmountCents: 1500,
    creditsUsed: 0,
    creditsTotal: 1500, // 1500 cents = $15 credit budget
    budgetUsedCents: 0,
    budgetTotalCents: 1500,
    budgetRemainingCents: 1500,
    overlayStorageBytesUsed: 0,
    overlayStorageBytesLimit: 0,
    dailyUsage: { ask: 0, write: 0, agent: 0 },
    dailyLimits: { ask: Infinity, write: Infinity, agent: Infinity },
    transcriptionSecondsUsed: 0,
    transcriptionSecondsLimit: Infinity, // Unlimited
    localTranscriptionEnabled: true, // Pro: local transcription enabled
    resetAt: '',
    billingPeriodEnd: ''
  },
  max: {
    tier: 'max',
    planKind: 'paid',
    planAmountCents: 9000,
    creditsUsed: 0,
    creditsTotal: 9000, // 9000 cents = $90 credit budget
    budgetUsedCents: 0,
    budgetTotalCents: 9000,
    budgetRemainingCents: 9000,
    overlayStorageBytesUsed: 0,
    overlayStorageBytesLimit: 0,
    dailyUsage: { ask: 0, write: 0, agent: 0 },
    dailyLimits: { ask: Infinity, write: Infinity, agent: Infinity },
    transcriptionSecondsUsed: 0,
    transcriptionSecondsLimit: Infinity, // Unlimited
    localTranscriptionEnabled: true, // Max: local transcription enabled
    resetAt: '',
    billingPeriodEnd: ''
  }
}

// ============ SERVICE ============

class SubscriptionService {
  private entitlements: UserEntitlements | null = null
  private pendingEvents: UsageEvent[] = []
  private cachePath: string | null = null
  private syncIntervalId: ReturnType<typeof setInterval> | null = null
  private userId: string | null = null

  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours
  private readonly SYNC_INTERVAL = 10 * 60 * 1000 // Sync every 10 minutes (reduced frequency)

  private getApiBaseUrl(): string {
    return serverProfileService.getActiveOrigin()
  }

  private getCachePath(): string {
    if (!this.cachePath) {
      this.cachePath = join(app.getPath('userData'), 'entitlements-cache.json')
    }
    return this.cachePath
  }

  /**
   * Set the user ID (called after auth succeeds)
   */
  setUserId(userId: string): void {
    this.userId = userId
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | null {
    return this.userId
  }

  /**
   * Clear user ID on sign out
   */
  clearUserId(): void {
    this.userId = null
  }

  /**
   * Initialize the subscription service
   * Loads cached entitlements and starts sync interval
   */
  async initialize(): Promise<void> {
    console.log('[SubscriptionService] Initializing...')

    // Load cached entitlements
    this.loadCachedEntitlements()

    // Try to sync fresh entitlements
    await this.syncEntitlements()

    // Start periodic sync (entitlements + flush events)
    this.syncIntervalId = setInterval(() => {
      this.syncEntitlements()
      this.flushPendingEvents()
    }, this.SYNC_INTERVAL)

    console.log('[SubscriptionService] Initialized')
  }

  /**
   * Cleanup on app quit
   */
  async shutdown(options: { flushPendingEvents?: boolean } = {}): Promise<void> {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId)
      this.syncIntervalId = null
    }
    if (options.flushPendingEvents !== false) {
      await this.flushPendingEvents()
    }
    console.log('[SubscriptionService] Shutdown complete')
  }

  /**
   * Get current entitlements
   */
  getEntitlements(): UserEntitlements | null {
    return this.entitlements
  }

  /**
   * Get remaining credits
   */
  getCreditsRemaining(): number {
    if (!this.entitlements) return 0
    if (this.entitlements.tier === 'free') return 0
    return Math.max(0, this.entitlements.creditsTotal - this.entitlements.creditsUsed)
  }

  /**
   * Check if user can perform an action BEFORE the request
   * Returns error codes that can be mapped to user-friendly messages in the renderer
   */
  canPerformAction(_type: 'ask' | 'write' | 'agent', modelId: string): ActionCheckResult {
    if (!this.entitlements) {
      return { allowed: false, reason: 'subscription_not_loaded' }
    }

    const { tier, dailyUsage } = this.entitlements

    // Free tier checks
    if (tier === 'free') {
      // Check model restriction
      if (isPremiumModel(modelId)) {
        return {
          allowed: false,
          reason: 'premium_model_not_allowed'
        }
      }
      // Check combined daily limits (15 total across ask/write/agent)
      const totalUsage = dailyUsage.ask + dailyUsage.write + dailyUsage.agent
      const combinedLimit = 15
      if (totalUsage >= combinedLimit) {
        return {
          allowed: false,
          reason: 'daily_limit_exceeded'
        }
      }
      return { allowed: true }
    }

    // Pro/Max tier checks
    const remaining = this.getCreditsRemaining()
    if (remaining <= 0 && isPremiumModel(modelId)) {
      return {
        allowed: false,
        reason: 'insufficient_credits'
      }
    }

    return { allowed: true }
  }

  /**
   * Check if local transcription is allowed
   */
  canUseLocalTranscription(): boolean {
    if (!this.entitlements) return false
    return this.entitlements.localTranscriptionEnabled
  }

  /**
   * Record usage AFTER a request completes
   * Updates local state immediately and queues for Convex sync
   * @param cost - Cost in DOLLARS (will be converted to cents internally)
   */
  recordUsage(
    type: 'ask' | 'write' | 'agent' | 'embedding',
    cost: number,
    modelId?: string,
    tokenData?: { inputTokens: number; outputTokens: number; cachedTokens: number }
  ): void {
    if (!this.entitlements) {
      console.warn('[SubscriptionService] Cannot record usage: not initialized')
      return
    }

    if (this.entitlements.tier === 'free' && type === 'embedding') {
      // Embedding billing is only applied for paid tiers.
      return
    }

    // Convert cost from dollars to cents - keep fractional cents for accuracy
    // Don't round to avoid losing small costs like $0.0015 = 0.15¢
    const costInCents = cost * 100

    // Create usage event for sync (store in cents with decimals)
    const event: UsageEvent = {
      type,
      modelId,
      inputTokens: tokenData?.inputTokens,
      outputTokens: tokenData?.outputTokens,
      cachedTokens: tokenData?.cachedTokens,
      cost: costInCents, // Store in cents (may have decimals)
      timestamp: Date.now()
    }
    this.pendingEvents.push(event)

    // Optimistic local update
    if (this.entitlements.tier === 'free') {
      if (type === 'ask' || type === 'write' || type === 'agent') {
        this.entitlements.dailyUsage[type]++
      }
    } else {
      // For paid tiers, use subscription credits (in cents, with fractional)
      this.entitlements.creditsUsed += costInCents
    }

    // Save to cache
    this.saveCachedEntitlements()

    // Notify renderer windows
    this.broadcastEntitlementsUpdate()

    // Detailed usage logging - show fractional cents for small costs
    const remaining = this.getCreditsRemaining()
    const percentUsed =
      this.entitlements.creditsTotal > 0
        ? ((this.entitlements.creditsUsed / this.entitlements.creditsTotal) * 100).toFixed(3)
        : '0'

    // Format cost display - show decimals for fractional cents
    const costDisplay = costInCents < 1 ? costInCents.toFixed(4) : costInCents.toFixed(2)
    const usedDisplay =
      this.entitlements.creditsUsed < 1
        ? this.entitlements.creditsUsed.toFixed(4)
        : this.entitlements.creditsUsed.toFixed(2)

    console.log('┌─────────────────────────────────────────────────────────')
    console.log(`│ [Usage] ${type.toUpperCase()} - ${modelId || 'free'}`)
    console.log(`│ Cost: ${costDisplay}¢ ($${cost.toFixed(6)})`)
    if (tokenData) {
      console.log(
        `│ Tokens: ${tokenData.inputTokens} in, ${tokenData.outputTokens} out, ${tokenData.cachedTokens} cached`
      )
    }
    console.log(
      `│ Credits: ${usedDisplay}¢ / ${this.entitlements.creditsTotal}¢ (${percentUsed}% used)`
    )
    console.log(`│ Remaining: ${remaining.toFixed(2)}¢ ($${(remaining / 100).toFixed(4)})`)
    console.log('└─────────────────────────────────────────────────────────')

    // Flush to Convex immediately to ensure persistence across window reloads
    this.flushPendingEvents().catch((err) => {
      console.error('[SubscriptionService] Background flush failed:', err)
    })
  }

  /**
   * Record transcription usage
   */
  recordTranscriptionUsage(seconds: number): void {
    console.log(`[SubscriptionService] recordTranscriptionUsage called with ${seconds} seconds`)

    if (!this.entitlements) {
      console.warn(
        '[SubscriptionService] No entitlements loaded, cannot record transcription usage'
      )
      return
    }

    const previousUsage = this.entitlements.transcriptionSecondsUsed
    const event: UsageEvent = {
      type: 'transcription',
      cost: seconds, // Convex backend uses cost field for transcription seconds
      timestamp: Date.now()
    }
    this.pendingEvents.push(event)

    this.entitlements.transcriptionSecondsUsed += seconds

    console.log(
      `[SubscriptionService] Transcription usage updated: ${previousUsage}s -> ${this.entitlements.transcriptionSecondsUsed}s (limit: ${this.entitlements.transcriptionSecondsLimit}s)`
    )
    console.log(
      `[SubscriptionService] Transcription minutes: ${(this.entitlements.transcriptionSecondsUsed / 60).toFixed(2)} / ${(this.entitlements.transcriptionSecondsLimit / 60).toFixed(2)} min`
    )

    this.saveCachedEntitlements()
    this.broadcastEntitlementsUpdate()

    console.log('[SubscriptionService] Broadcasted entitlements update to all windows')

    // Flush to Convex immediately to ensure persistence across window reloads
    this.flushPendingEvents().catch((err) => {
      console.error('[SubscriptionService] Background flush failed:', err)
    })
  }

  /**
   * Force refresh entitlements from server
   */
  async refresh(): Promise<void> {
    await this.syncEntitlements()
  }

  // ============ PRIVATE METHODS ============

  private async syncEntitlements(): Promise<void> {
    const userId = this.getUserId()

    if (!userId) {
      console.log('[SubscriptionService] No userId available, using cached/default entitlements')
      // Use defaults based on cached tier or free
      const tier = this.entitlements?.tier || 'free'
      const defaults = TIER_DEFAULTS[tier]

      if (!this.entitlements) {
        this.entitlements = {
          ...defaults,
          lastSyncedAt: Date.now()
        }
      }
      return
    }

    // Flush any pending events before fetching to ensure Convex has latest data
    if (this.pendingEvents.length > 0) {
      console.log('[SubscriptionService] Flushing pending events before sync...')
      await this.flushPendingEvents()
    }

    try {
      console.log('[SubscriptionService] Syncing entitlements from app server...')

      interface ConvexEntitlements {
        tier: SubscriptionTier
        planKind?: 'free' | 'paid'
        planAmountCents?: number
        creditsUsed: number
        creditsTotal: number
        budgetUsedCents?: number
        budgetTotalCents?: number
        budgetRemainingCents?: number
        overlayStorageBytesUsed?: number
        overlayStorageBytesLimit?: number
        dailyUsage: { ask: number; write: number; agent: number }
        dailyLimits: { ask: number; write: number; agent: number }
        transcriptionSecondsUsed: number
        transcriptionSecondsLimit: number
        localTranscriptionEnabled: boolean
        resetAt: string
        billingPeriodEnd: string
        lastSyncedAt: number
      }

      // Access-token verification fetches WorkOS JWKS, so do that in the app server
      // and keep this desktop path on the server-secret Convex route used by the web app.
      const fetchFromAppServer = async (): Promise<Response> => {
        const subscriptionUrl = new URL(
          '/api/auth/native/subscription',
          this.getApiBaseUrl()
        )
        // Rolling compatibility: older Overlay Servers require this claimed ID
        // and verify it against the signed access-token subject. New servers
        // treat it only as an optional mismatch check.
        subscriptionUrl.searchParams.set('userId', userId)
        return await fetch(subscriptionUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${keyCacheService.getAccessToken() || ''}`
          }
        })
      }

      let response = await fetchFromAppServer()
      if (response.status === 401 && (await keyCacheService.refreshAccessTokenIfPossible())) {
        response = await fetchFromAppServer()
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(
          `Native subscription fetch failed (${response.status} ${response.statusText})${errorText ? `: ${errorText.slice(0, 300)}` : ''}`
        )
      }

      const result = (await response.json()) as ConvexEntitlements

      if (result) {
        // Convex stores:
        // - creditsTotal in DOLLARS (15 for pro, 90 for max) - convert to CENTS
        // - creditsUsed in CENTS (already accumulated from app) - keep as-is
        const creditsTotalCents = (result.creditsTotal || 0) * 100
        const creditsUsedCents = result.creditsUsed || 0 // Already in cents from app

        this.entitlements = {
          tier: result.tier || 'free',
          planKind: result.planKind,
          planAmountCents: result.planAmountCents,
          creditsUsed: creditsUsedCents,
          creditsTotal: creditsTotalCents,
          budgetUsedCents: result.budgetUsedCents ?? creditsUsedCents,
          budgetTotalCents: result.budgetTotalCents ?? creditsTotalCents,
          budgetRemainingCents:
            result.budgetRemainingCents ?? Math.max(0, creditsTotalCents - creditsUsedCents),
          overlayStorageBytesUsed: Math.max(0, result.overlayStorageBytesUsed ?? 0),
          overlayStorageBytesLimit: Math.max(0, result.overlayStorageBytesLimit ?? 0),
          dailyUsage: result.dailyUsage || { ask: 0, write: 0, agent: 0 },
          dailyLimits: result.dailyLimits || TIER_DEFAULTS[result.tier || 'free'].dailyLimits,
          transcriptionSecondsUsed: result.transcriptionSecondsUsed || 0,
          transcriptionSecondsLimit: result.transcriptionSecondsLimit || 600,
          localTranscriptionEnabled: result.localTranscriptionEnabled ?? false,
          resetAt: result.resetAt || '',
          billingPeriodEnd: result.billingPeriodEnd || '',
          lastSyncedAt: Date.now()
        }

        this.saveCachedEntitlements()
        this.broadcastEntitlementsUpdate()
        console.log(`[SubscriptionService] Synced from app server (tier: ${this.entitlements.tier})`)
      } else {
        console.log('[SubscriptionService] No entitlements from app server, using defaults')
        // User exists but no subscription record yet - use free tier
        if (!this.entitlements) {
          this.entitlements = {
            ...TIER_DEFAULTS.free,
            lastSyncedAt: Date.now()
          }
          this.saveCachedEntitlements()
        }
      }
    } catch (error) {
      console.error('[SubscriptionService] Entitlements sync failed:', error)
      // Keep using cached entitlements
      if (this.entitlements) {
        this.entitlements.lastSyncedAt = Date.now()
        this.saveCachedEntitlements()
      }
    }
  }

  private async flushPendingEvents(): Promise<void> {
    // Never send client-calculated cost or usage to the authoritative billing
    // ledger. These events describe local/BYOK work and are discarded after
    // driving local UX. Hosted work is accounted by the app server.
    this.pendingEvents = []
  }

  private loadCachedEntitlements(): void {
    try {
      const path = this.getCachePath()
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf-8'))

        let data: UserEntitlements
        if (raw.payload && raw.signature) {
          const expectedSig = this.signCache(raw.payload)
          if (raw.signature !== expectedSig) {
            console.warn('[SubscriptionService] Cache HMAC verification failed — ignoring tampered cache')
            this.entitlements = { ...TIER_DEFAULTS.free, lastSyncedAt: Date.now() }
            return
          }
          data = JSON.parse(raw.payload)
        } else {
          data = raw
        }

        if (Date.now() - data.lastSyncedAt < this.CACHE_DURATION) {
          this.entitlements = data
          console.log('[SubscriptionService] Loaded cached entitlements')
          return
        }
        console.log('[SubscriptionService] Cache expired')
      }
    } catch (error) {
      console.error('[SubscriptionService] Failed to load cache:', error)
    }

    this.entitlements = {
      ...TIER_DEFAULTS.free,
      lastSyncedAt: Date.now()
    }
  }

  private getCacheHmacKey(): string {
    return `overlay-entitlements-${app.getPath('userData')}-${process.platform}`
  }

  private signCache(data: string): string {
    return createHmac('sha256', this.getCacheHmacKey()).update(data).digest('hex')
  }

  private saveCachedEntitlements(): void {
    if (!this.entitlements) return

    try {
      const path = this.getCachePath()
      const payload = JSON.stringify(this.entitlements)
      const signature = this.signCache(payload)
      writeFileSync(path, JSON.stringify({ payload, signature }), {
        encoding: 'utf-8',
        mode: 0o600
      })
      chmodSync(path, 0o600)
    } catch (error) {
      console.error('[SubscriptionService] Failed to save cache:', error)
    }
  }

  private broadcastEntitlementsUpdate(): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('subscription:updated', this.entitlements)
      }
    }
  }

  // ============ DEV MODE ============

  /**
   * Override tier for development testing
   */
  setDevTierOverride(tier: SubscriptionTier): void {
    const defaults = TIER_DEFAULTS[tier]
    this.entitlements = {
      ...defaults,
      lastSyncedAt: Date.now()
    }
    this.saveCachedEntitlements()
    this.broadcastEntitlementsUpdate()
    console.log(`[SubscriptionService] Dev tier override: ${tier}`)
  }

  /**
   * Reset usage for testing
   */
  resetUsageForTesting(): void {
    if (!this.entitlements) return
    this.entitlements.creditsUsed = 0
    this.entitlements.dailyUsage = { ask: 0, write: 0, agent: 0 }
    this.entitlements.transcriptionSecondsUsed = 0
    this.saveCachedEntitlements()
    this.broadcastEntitlementsUpdate()
    console.log('[SubscriptionService] Usage reset for testing')
  }

  /**
   * Override full state for development testing (e.g., zero credits scenario)
   */
  setDevStateOverride(state: Partial<UserEntitlements>): void {
    if (!this.entitlements) {
      this.entitlements = { ...TIER_DEFAULTS.pro, lastSyncedAt: Date.now() }
    }
    this.entitlements = {
      ...this.entitlements,
      ...state,
      lastSyncedAt: Date.now()
    }
    this.saveCachedEntitlements()
    this.broadcastEntitlementsUpdate()
    console.log('[SubscriptionService] Dev state override:', state)
  }
}

export const subscriptionService = new SubscriptionService()

// ============ TEST FUNCTION ============
// Run with: npx ts-node src/main/services/subscription-service.ts
if (require.main === module) {
  // Mock electron app for testing
  const mockApp = {
    getPath: () => '/tmp'
  }
  ;(global as unknown as { app: typeof mockApp }).app = mockApp

  console.log('=== Subscription Service Test ===\n')

  // Test TIER_DEFAULTS
  console.log('Free tier defaults:', JSON.stringify(TIER_DEFAULTS.free, null, 2))
  console.log('\nPro tier defaults:', JSON.stringify(TIER_DEFAULTS.pro, null, 2))
  console.log('\nMax tier defaults:', JSON.stringify(TIER_DEFAULTS.max, null, 2))

  // Test isPremiumModel integration
  console.log('\n--- Premium Model Checks ---')
  console.log(`isPremiumModel('openrouter/free'): ${isPremiumModel('openrouter/free')}`)
  console.log(`isPremiumModel('claude-sonnet-4-6'): ${isPremiumModel('claude-sonnet-4-6')}`)

  // Test calculateTokenCost integration
  console.log('\n--- Cost Calculation ---')
  const cost = calculateTokenCost('claude-sonnet-4-6', 5000, 1000, 2000)
  console.log(`Claude Sonnet cost (5000 in, 1000 cached, 2000 out): $${cost.toFixed(4)}`)

  console.log('\n=== Tests Complete ===')
}
