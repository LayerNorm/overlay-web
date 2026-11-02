import 'server-only'

import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { hasZeroPricing, type FreeReceipt } from '@/shared/ai/gateway/overlay-free-policy'
import { logger } from '@/server/observability/logger'
import type { OverlayFreeReceiptSummary, OverlayFreeRoute } from './overlay-free-router-contracts'
import { OPENROUTER_GENERATION_COST_MAX_DURATION_MS } from './openrouter-generation-cost'

export function receiptSummary(value: FreeReceipt): OverlayFreeReceiptSummary {
  return {
    safe: value.safe,
    cost: value.cost,
    ...(value.reason ? { reason: value.reason } : {}),
    ...(value.code ? { code: value.code } : {}),
    ...(value.actualModelId ? { actualModelId: value.actualModelId } : {}),
    ...(value.actualProvider ? { actualProvider: value.actualProvider } : {}),
  }
}

export function overlayMetadata(
  providerMetadata: LanguageModelV4GenerateResult['providerMetadata'],
  route: OverlayFreeRoute,
  receipt: OverlayFreeReceiptSummary,
) {
  return {
    ...providerMetadata,
    overlayFree: {
      route: receipt.actualModelId ?? route.modelId,
      provider: receipt.actualProvider ?? route.provider,
      safe: receipt.safe,
      cost: receipt.cost,
      ...(receipt.reason ? { reason: receipt.reason } : {}),
      ...(receipt.code ? { code: receipt.code } : {}),
    },
  }
}

export function logUnsafeReceipt(route: OverlayFreeRoute, receipt: OverlayFreeReceiptSummary): void {
  if (receipt.safe) return
  logger.warn('[overlay-free] unsafe provider receipt', {
    routeKey: route.routeKey,
    cost: receipt.cost,
    reason: receipt.reason ?? 'unsafe receipt',
    receiptCode: receipt.code ?? 'unknown',
    transport: route.transport,
  })
}

export async function reconcileMissingFreeReceipt(input: {
  receipt: FreeReceipt
  route: OverlayFreeRoute
  generationId?: string
  abortSignal?: AbortSignal
  confirm?: (generationId: string) => Promise<boolean>
}): Promise<FreeReceipt> {
  const { receipt, route, generationId, confirm, abortSignal } = input
  const leaseExpiresAt = route.activeLeaseExpiresAt
  if (receipt.code !== 'missing_cost' || receipt.safe || receipt.cost !== null
    || route.transport !== 'openrouter' || route.provider !== 'openrouter'
    || route.quarantineReason || !route.activeLeaseToken || leaseExpiresAt === undefined || !Number.isFinite(leaseExpiresAt)
    || !generationId || generationId.length > 256 || !/^gen-[0-9A-Za-z-]+$/.test(generationId)
    || !confirm || abortSignal?.aborted
    || leaseExpiresAt - Date.now() < OPENROUTER_GENERATION_COST_MAX_DURATION_MS + 15_000) return receipt
  try {
    if (!hasZeroPricing(JSON.parse(route.pricingJson))) return receipt
    const confirmed = await confirm(generationId)
    if (!confirmed || abortSignal?.aborted || leaseExpiresAt - Date.now() <= 15_000) return receipt
    return { ...receipt, safe: true, cost: 0, reason: null, code: undefined }
  } catch (_error) {
    return receipt
  }
}
