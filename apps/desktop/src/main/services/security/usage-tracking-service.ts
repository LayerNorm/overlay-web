// Local/BYOK usage telemetry. This service must never mutate Overlay's
// authoritative usage or billing ledger; hosted work is accounted by the server.

import { auditLogger } from './security-service'
import { calculateTokenCost } from '../model-pricing'
import { subscriptionService } from '../subscription-service'

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
  totalTokens: number
  model: string
  provider: string
  operation: 'chat' | 'agent' | 'notebook' | 'browser' | 'embedding' | 'transcription' | 'search'
  timestamp: number
}

export interface UsageTrackingResult {
  success: boolean
  creditsUsed: number
  creditsRemaining: number
  percentageRemaining: number
  transcriptionMinutesRemaining?: number
  transcriptionPercentageRemaining?: number
  error?: string
}

class UsageTrackingService {
  private userId: string | null = null

  setCredentials(_accessToken: string, userId: string): void {
    this.userId = userId
  }

  clearCredentials(): void {
    this.userId = null
  }

  async trackUsage(
    usage: Omit<TokenUsage, 'timestamp' | 'totalTokens'>
  ): Promise<UsageTrackingResult> {
    const localProviderCostUsd = calculateTokenCost(
      usage.model,
      usage.inputTokens,
      usage.cachedTokens || 0,
      usage.outputTokens
    )
    auditLogger.log({
      type: 'platform/usage:track',
      action: `Local/BYOK usage: ${usage.operation} with ${usage.model}`,
      userId: this.userId ?? undefined,
      details: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        model: usage.model,
        provider: usage.provider,
        localProviderCostUsd
      },
      success: true
    })
    return this.localResult(localProviderCostUsd)
  }

  async trackTranscriptionUsage(durationSeconds: number): Promise<UsageTrackingResult> {
    auditLogger.log({
      type: 'platform/usage:track',
      action: 'Local transcription usage',
      userId: this.userId ?? undefined,
      details: { durationSeconds },
      success: true
    })
    return this.localResult(0)
  }

  async getUsageStats(): Promise<{
    creditsUsed: number
    creditsTotal: number
    percentageRemaining: number
    transcriptionMinutesUsed?: number
    transcriptionMinutesLimit?: number
    transcriptionPercentageRemaining?: number
  } | null> {
    const entitlements = subscriptionService.getEntitlements()
    if (!entitlements) return null
    const creditsTotal = entitlements.budgetTotalCents ?? entitlements.creditsTotal
    const creditsUsed = entitlements.budgetUsedCents ?? entitlements.creditsUsed
    const percentageRemaining = creditsTotal > 0
      ? Math.max(0, Math.round(((creditsTotal - creditsUsed) / creditsTotal) * 100))
      : 100
    const transcriptionLimit = entitlements.transcriptionSecondsLimit ?? 0
    const transcriptionUsed = entitlements.transcriptionSecondsUsed ?? 0
    return {
      creditsUsed,
      creditsTotal,
      percentageRemaining,
      transcriptionMinutesUsed: transcriptionUsed / 60,
      transcriptionMinutesLimit: transcriptionLimit / 60,
      transcriptionPercentageRemaining: transcriptionLimit > 0
        ? Math.max(0, Math.round(((transcriptionLimit - transcriptionUsed) / transcriptionLimit) * 100))
        : 100
    }
  }

  private localResult(localProviderCostUsd: number): UsageTrackingResult {
    const entitlements = subscriptionService.getEntitlements()
    const total = entitlements?.budgetTotalCents ?? entitlements?.creditsTotal ?? 0
    const remaining = entitlements?.budgetRemainingCents ??
      Math.max(0, total - (entitlements?.budgetUsedCents ?? entitlements?.creditsUsed ?? 0))
    return {
      success: true,
      creditsUsed: localProviderCostUsd,
      creditsRemaining: remaining,
      percentageRemaining: total > 0 ? Math.round((remaining / total) * 100) : 100
    }
  }
}

export const usageTrackingService = new UsageTrackingService()
