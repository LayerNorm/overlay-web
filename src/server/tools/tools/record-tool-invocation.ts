import 'server-only'

import { shouldPersistToolInvocation, toolCostBucketForId } from './tool-buckets'
import { toolCallBillableCostUsd } from '@/shared/billing/tool-pricing'

export function fireAndForgetRecordToolInvocation(args: {
  accessToken?: string
  serverSecret?: string
  userId: string
  workspaceId?: string
  toolName: string
  mode: 'act'
  modelId?: string
  conversationId?: string
  turnId?: string
  success: boolean
  durationMs?: number
  error?: unknown
}): void {
  const bucket = toolCostBucketForId(args.toolName)
  if (!shouldPersistToolInvocation(bucket)) return

  const errorMessage = args.success
    ? undefined
    : args.error instanceof Error
      ? args.error.message.slice(0, 2000)
      : String(args.error ?? '').slice(0, 2000)

  void recordToolInvocation({ ...args, bucket, errorMessage }).catch((_error) => undefined)
}

async function recordToolInvocation(args: Parameters<typeof fireAndForgetRecordToolInvocation>[0] & {
  bucket: ReturnType<typeof toolCostBucketForId>
  errorMessage?: string
}): Promise<void> {
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  const context = getOverlayServerContext()

  // Flat per-call pricing (e.g. Composio at $0.0003/call). Buckets billed
  // through their own reservation routes stay at $0 here to avoid double
  // charging. Failed calls are recorded but not billed.
  const callPriceUsd = args.success ? toolCallBillableCostUsd(args.bucket) : undefined
  const billableCostCents = callPriceUsd === undefined ? 0 : callPriceUsd * 100
  const providerCostCents = callPriceUsd === undefined ? undefined : billableCostCents
  const payer = args.workspaceId === undefined
    ? null
    : await context.billingPayerResolver
        .resolve({ userId: args.userId, workspaceId: args.workspaceId })
        .then((resolved) => (resolved.scope === 'workspace' ? resolved : null))
        .catch((_error) => null)

  if (context.appDataCapabilities.provider === 'postgres') {
    const event = {
      costCents: billableCostCents,
      kind: 'agent' as const,
      metadata: {
        conversationId: args.conversationId,
        costBucket: args.bucket,
        durationMs: args.durationMs,
        errorMessage: args.errorMessage,
        success: args.success,
        toolId: args.toolName,
        turnId: args.turnId,
      },
      modelId: args.modelId,
      occurredAt: Date.now(),
      providerCostUsd: callPriceUsd,
    }
    const workspaceBilling = payer
      ? { billingAccountId: payer.billingAccountId, workspaceId: payer.workspaceId! }
      : undefined
    const operationId = `tool_${globalThis.crypto.randomUUID()}`
    try {
      await context.appData.repositories.usage.recordBatch({
        events: [event],
        operationId,
        userId: args.userId,
        workspaceBilling,
      })
    } catch (error) {
      if (!(error instanceof Error && error.message === 'insufficient_budget' && billableCostCents > 0)) {
        throw error
      }
      await context.appData.repositories.usage.recordBatch({
        events: [{ ...event, costCents: 0 }],
        operationId,
        userId: args.userId,
        workspaceBilling,
      })
    }
    return
  }

  const { convex } = await import('@/server/database/convex')
  await convex.mutation(
    'platform/usage:recordToolInvocation',
    {
      accessToken: args.accessToken,
      serverSecret: args.serverSecret,
      userId: args.userId,
      toolId: args.toolName,
      mode: args.mode,
      modelId: args.modelId,
      conversationId: args.conversationId,
      turnId: args.turnId,
      workspaceId: payer?.workspaceId,
      workspaceBillingAccountId: payer?.billingAccountId,
      success: args.success,
      durationMs: args.durationMs,
      costBucket: args.bucket,
      providerCostCents,
      billableCostCents,
      errorMessage: args.errorMessage,
    },
    { background: true, suppressNetworkConsoleError: true },
  )
}
