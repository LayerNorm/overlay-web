import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { UsageEvent, UsageRepository } from './UsageRepository'

export class ConvexUsageRepository implements UsageRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async getEntitlements(args: { userId: string }): Promise<Entitlements | null> {
    return await convex.query<Entitlements | null>('platform/usage:getEntitlementsByServer', {
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
  }

  async recordBatch(args: {
    events: UsageEvent[]
    operationId: string
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<{ recorded: number; budgetLow: boolean }> {
    const result = await convex.mutation<{ recorded?: number; budgetLow?: boolean }>('platform/usage:recordBatch', {
      events: args.events.map(toConvexEvent),
      operationId: args.operationId,
      serverSecret: this.serverSecret,
      userId: args.userId,
      workspaceId: args.workspaceId,
      ...(args.programmaticSubjectId ? { programmaticSubjectId: args.programmaticSubjectId } : {}),
    }, { throwOnError: true })
    if (!result) throw new Error('Failed to record usage batch')
    return { recorded: result.recorded ?? args.events.length, budgetLow: result.budgetLow === true }
  }
}

function toConvexEvent(event: UsageEvent) {
  return {
    cachedTokens: event.cachedTokens,
    countAsRequest: event.countAsRequest,
    cost: event.costCents,
    durationSeconds: event.durationSeconds,
    inputTokens: event.inputTokens,
    modelId: event.modelId,
    outputTokens: event.outputTokens,
    providerCostUsd: event.providerCostUsd,
    timestamp: event.occurredAt,
    type: event.kind,
  }
}
