import 'server-only'

import { createGateway } from 'ai'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import { getServerProviderKey } from './server-provider-keys'

/**
 * Global `AI_GATEWAY_API_KEY` credit tracking.
 *
 * When the shared gateway key's balance falls below the threshold, chat model
 * resolution prefers free models (the OpenRouter free router or a NIM free
 * model) so the remaining credit is preserved. The balance is read via
 * `gateway.getCredits()` (GET /v1/credits) and cached briefly; a 402 from any
 * gateway call also marks the key as low until the cache refreshes.
 */

export const DEFAULT_GATEWAY_LOW_CREDIT_THRESHOLD_USD = 5
const CREDITS_CACHE_TTL_MS = 60_000

type GatewayCreditCacheEntry = {
  apiKey: string
  balanceUsd: number
  expiresAt: number
}

let creditCache: GatewayCreditCacheEntry | null = null

export function gatewayLowCreditThresholdUsd(): number {
  const raw = process.env.AI_GATEWAY_LOW_CREDIT_THRESHOLD_USD?.trim()
  if (!raw) return DEFAULT_GATEWAY_LOW_CREDIT_THRESHOLD_USD
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_GATEWAY_LOW_CREDIT_THRESHOLD_USD
}

/**
 * Remaining USD balance for the global gateway key, or null when the key is
 * missing or the credits endpoint cannot be read. Fails open — a flaky
 * /v1/credits response must never block paid traffic.
 */
export async function getGatewayCreditBalanceUsd(
  fetchImpl?: typeof fetch,
): Promise<number | null> {
  try {
    const apiKey = await getServerProviderKey('ai_gateway')
    if (!apiKey) return null

    const now = Date.now()
    if (creditCache && creditCache.apiKey === apiKey && creditCache.expiresAt > now) {
      return creditCache.balanceUsd
    }

    const gateway = createGateway({
      apiKey,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    })
    const credits = await gateway.getCredits()
    const balanceUsd = Number.parseFloat(credits.balance)
    if (!Number.isFinite(balanceUsd)) return null

    creditCache = { apiKey, balanceUsd, expiresAt: now + CREDITS_CACHE_TTL_MS }
    return balanceUsd
  } catch (error) {
    logger.warn('[gateway-credits] failed to read AI Gateway credit balance', {
      error: summarizeErrorForLog(error),
    })
    return null
  }
}

export async function isGatewayCreditLow(
  thresholdUsd = gatewayLowCreditThresholdUsd(),
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  const balanceUsd = await getGatewayCreditBalanceUsd(fetchImpl)
  return balanceUsd !== null && balanceUsd < thresholdUsd
}

/**
 * Mark the global key as effectively empty until the cache TTL expires. Called
 * when a gateway response returns 402 (insufficient credits / spend limit), so
 * subsequent model resolutions skip straight to the free fallback instead of
 * burning paid attempts that will fail.
 */
export function markGatewayCreditLow(apiKey?: string): void {
  const now = Date.now()
  if (apiKey) {
    if (!creditCache || creditCache.apiKey === apiKey || creditCache.expiresAt <= now) {
      creditCache = { apiKey, balanceUsd: 0, expiresAt: now + CREDITS_CACHE_TTL_MS }
      return
    }
  }
  if (creditCache) creditCache = { ...creditCache, balanceUsd: 0 }
}

/** Test hook — clears the cached balance between cases. */
export function resetGatewayCreditCacheForTests(): void {
  creditCache = null
}

/** Fetch wrapper for `createGateway` — flips the cached balance to low on 402. */
export function createGatewayCreditTrackingFetch(apiKey: string): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init)
    if (response.status === 402) markGatewayCreditLow(apiKey)
    return response
  }
}
