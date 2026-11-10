import 'server-only'

import type { Entitlements } from '@/shared/app/app-contracts'

export type UsageSpendKind =
  | 'ask'
  | 'write'
  | 'agent'
  | 'embedding'
  | 'transcription'
  | 'generation'
  | 'sandbox'

export type UsageEvent = {
  cachedTokens?: number
  /** Internal model/child calls set false; the root request is counted separately. Server-owned only. */
  countAsRequest?: boolean
  costCents: number
  durationSeconds?: number
  eventId?: string
  inputTokens?: number
  kind: UsageSpendKind
  metadata?: Record<string, unknown>
  modelId?: string
  occurredAt: number
  outputTokens?: number
  providerCostUsd?: number
}

/** Usage is charged after each paid call; nothing is reserved or held before it. */
export interface UsageRepository {
  getEntitlements(args: { userId: string }): Promise<Entitlements | null>
  recordBatch(args: {
    events: UsageEvent[]
    operationId: string
    userId: string
    workspaceId?: string
    /** Charges this program's admin spend limit instead of the member's. */
    programmaticSubjectId?: string
  }): Promise<{ recorded: number; budgetLow: boolean }>
}
