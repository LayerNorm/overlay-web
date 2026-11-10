import 'server-only'

import { createHash } from 'node:crypto'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { FatalError } from 'workflow'
import type { Entitlements } from '@/shared/app/app-contracts'
import { isRetiredHostedModelId } from '@/shared/ai/gateway/model-types'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { workspaceBudgetLow, workspaceBudgetStopLineCents } from '@/shared/billing/execution-access'
import { ensurePayerBudgetAvailable } from '@/server/billing/billing-runtime'
import { getBudgetTotals } from '@/server/billing/billing-runtime-details'
import { getOverlayCapabilities } from '@/server/capabilities'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'
import type { HarnessModelReference } from './secure-model'

/** The run stops with WORKSPACE_FUNDS; see harness-diagnostics. */
export const HARNESS_WORKSPACE_BUDGET_LOW_MESSAGE = 'The workspace budget is under 2%.'

export type HarnessModelDispatch = {
  access: HarnessExecutionReference & { workspaceId: string }
  receiptId: string
  requestFingerprint: string
  billingProgrammaticSubjectId?: string
  maxOutputTokens: number
  contextWindow: number | null
}

type DispatchAuthority = {
  entitlements: Entitlements
  requiresZeroDataRetention?: boolean
  billingProgrammaticSubjectId?: string
}

function assertPreparedDispatch(
  reference: HarnessModelReference,
  input: HarnessModelDispatch,
  options: LanguageModelV4CallOptions,
): void {
  if (isRetiredHostedModelId(reference.modelId)) {
    throw new FatalError('This hosted model is retired. Choose a supported paid model.')
  }
  if ((reference.personal && reference.native) || reference.credentialOwnerId !== input.access.actorUserId) {
    throw new FatalError('Harness model dispatch identity or routing is invalid.')
  }
  if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0
    || !Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens! <= 0 || options.maxOutputTokens! > input.maxOutputTokens) {
    throw new FatalError('The model call exceeds its prepared output limit.')
  }
  if (options.tools?.some(tool => tool.type === 'provider')) {
    throw new FatalError('Provider-executed tools require separate spend authorization.')
  }
  for (const routing of [options.providerOptions?.gateway, options.providerOptions?.openrouter]) {
    if (routing?.models !== undefined && (!Array.isArray(routing.models) || routing.models.length > 0)) {
      throw new FatalError('Model fallback must be prepared and authorized before dispatch.')
    }
  }
}

async function validateCurrentDispatch(
  reference: HarnessModelReference,
  options: LanguageModelV4CallOptions,
  input: HarnessModelDispatch,
  refreshed: DispatchAuthority,
) {
  if (refreshed.requiresZeroDataRetention && options.providerOptions?.gateway?.zeroDataRetention !== true) {
    throw new FatalError('The model call must use current zero data retention routing.')
  }
  const state = await new ConvexHarnessRepository().get({ actorUserId: input.access.actorUserId, runId: input.access.runId })
  const marker = state?.modelReservation
  if (!state || state.workflowRunId !== input.access.workflowRunId || marker?.id !== input.receiptId || marker.dispatch) {
    throw new FatalError('Model dispatch is missing its marker or has already been attempted.')
  }
  const byok = isByokModelId(reference.modelId)
  if (state.policy.executionPolicyVersion === 2 && ((state.policy.spendingMode === 'external') !== byok)) {
    throw new FatalError('The model does not match this harness spending mode.')
  }
  if (state.policy.executionPolicyVersion === 2 && state.policy.spendingMode === 'none' && !byok) {
    throw new FatalError('Paid model execution requires workspace funding or external credentials.')
  }
  return {
    paysFromWorkspace: !byok && (state.policy.executionPolicyVersion !== 2 || state.policy.spendingMode === 'workspace'),
    operationId: `harness-model:${createHash('sha256').update(JSON.stringify([input.access.runId, input.receiptId])).digest('hex')}`,
  }
}

// The only spending check: the real balance, never an estimate of this call.
async function assertWorkspaceBudgetNotLow(input: HarnessModelDispatch, refreshed: DispatchAuthority): Promise<void> {
  if (!(await getOverlayCapabilities()).billing) return
  const totals = getBudgetTotals(refreshed.entitlements)
  if (!workspaceBudgetLow(totals)) return
  const topUp = await ensurePayerBudgetAvailable({
    entitlements: refreshed.entitlements,
    minimumRequiredCents: workspaceBudgetStopLineCents(totals),
    userId: input.access.actorUserId, workspaceId: input.access.workspaceId,
    programmaticSubjectId: refreshed.billingProgrammaticSubjectId ?? input.billingProgrammaticSubjectId,
  })
  if (workspaceBudgetLow(getBudgetTotals(topUp.entitlements))) throw new FatalError(HARNESS_WORKSPACE_BUDGET_LOW_MESSAGE)
}

// Binding marks the call as sent, so a bound dispatch is never automatically sent again.
async function claimModelDispatch(input: HarnessModelDispatch, modelId: string, operationId: string): Promise<void> {
  const repository = new ConvexHarnessRepository()
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await repository.get({ actorUserId: input.access.actorUserId, runId: input.access.runId })
    if (current?.workflowRunId !== input.access.workflowRunId || current.modelReservation?.id !== input.receiptId || current.modelReservation.dispatch) {
      throw new FatalError('Model dispatch has already been claimed or revoked.')
    }
    const result = await repository.apply({
      actorUserId: input.access.actorUserId, runId: input.access.runId,
      workflowRunId: input.access.workflowRunId,
      executionGeneration: input.access.executionGeneration ?? 0,
      operationId: `${operationId}:dispatch`, expectedRevision: current.revision,
      operation: { type: 'bind_model_dispatch', id: input.receiptId, modelId, billingReservationId: null },
    })
    if (result.conflict) continue
    if (!result.applied) throw new FatalError('Model dispatch has already been claimed.')
    return
  }
  throw new FatalError('Model dispatch ownership is contended.')
}

// Runs inside the actual provider step. No credentials or resolved grants cross
// its durable boundary. The actual cost is charged after the call settles.
export async function authorizeHarnessModelDispatch(
  reference: HarnessModelReference,
  options: LanguageModelV4CallOptions,
  input: HarnessModelDispatch,
  authorize: () => Promise<DispatchAuthority>,
): Promise<void> {
  assertPreparedDispatch(reference, input, options)
  const refreshed = await authorize()
  const current = await validateCurrentDispatch(reference, options, input, refreshed)
  if (current.paysFromWorkspace) await assertWorkspaceBudgetNotLow(input, refreshed)
  await claimModelDispatch(input, reference.modelId, current.operationId)
}
