import { api, internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'

// Plain helpers with no function definitions, so node-runtime actions can import them.
// The gate itself is `billing/providerBudget:providerBudgetGate`.

/** Before a background provider call: the 2% workspace check and spend limit. Nothing is held. */
export async function checkProviderBudget(ctx: ActionCtx, args: {
  userId: string
  workspaceId?: string
  programmaticSubjectId?: string
  operationId?: string
}): Promise<{ allowed: boolean; alreadyCharged: boolean }> {
  return await ctx.runQuery(internal.billing.providerBudget.providerBudgetGate, args)
}

/** Charges a finished call's actual cost directly; the operation id keeps it once-only. */
export async function chargeProviderUsageDirect(ctx: ActionCtx, args: {
  serverSecret: string
  userId: string
  workspaceId?: string
  programmaticSubjectId?: string
  operationId: string
  costCents: number
  event: {
    type: 'embedding' | 'generation'
    modelId: string
    inputTokens: number
    outputTokens: number
    providerCostUsd: number
  }
}): Promise<{ budgetLow: boolean }> {
  const result = await ctx.runMutation(api.platform.usage.recordBatch, {
    serverSecret: args.serverSecret,
    userId: args.userId,
    ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    ...(args.programmaticSubjectId ? { programmaticSubjectId: args.programmaticSubjectId } : {}),
    operationId: args.operationId,
    events: [{ ...args.event, cachedTokens: 0, cost: args.costCents, timestamp: Date.now() }],
  }) as { budgetLow?: boolean }
  return { budgetLow: result.budgetLow === true }
}
