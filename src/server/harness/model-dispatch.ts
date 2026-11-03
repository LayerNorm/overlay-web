import 'server-only'

import { createHash } from 'node:crypto'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { FatalError } from 'workflow'
import { isSafeHarnessFundingCents } from '@overlay/agent-runtime/harness-resource'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { reserveProviderBudget, markProviderBudgetStarted, releaseProviderBudgetReservation } from '@/server/billing/billing-runtime'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'
import { estimateHarnessInputTokens, forecastHarnessModelCost, hasHarnessCacheWrites } from './model-forecast'
import type { HarnessModelReference } from './secure-model'
import { recordHarnessModelRejection } from './model-rejection'
import { applyHarnessOperation, readHarnessState } from './state-steps'
import { HarnessYield } from './model-recovery'

function fundingPauseReason(rawReason: string): import('@overlay/agent-runtime/harness-state').HarnessFundingPause['reason'] {
  return rawReason === 'payment_failed' ? 'payment_failed'
    : rawReason === 'monthly_limit' || rawReason === 'monthly_limit_reached' ? 'monthly_limit_reached'
            : rawReason === 'missing_payment_method' || rawReason === 'missing_method' || rawReason === 'missing_customer' ? 'missing_payment_method'
              : rawReason === 'missing_consent' ? 'missing_consent'
                : rawReason === 'amount_shortfall' || rawReason === 'shortfall' ? 'amount_shortfall'
                  : rawReason === 'not_paid' ? 'not_paid'
                    : rawReason === 'pending' ? 'pending'
                      : rawReason === 'disabled' ? 'disabled'
                        : rawReason === 'authorization_changed' ? 'authorization_changed'
                          : rawReason === 'task_deadline_expired' ? 'task_deadline_expired'
                            : rawReason === 'unknown_receipt' ? 'unknown_receipt'
                              : 'insufficient_budget'
}

function exactFundingAmounts(status: Record<string, unknown>) {
  if (!isSafeHarnessFundingCents(status.requiredCents) || status.requiredCents <= 0
    || !isSafeHarnessFundingCents(status.remainingCents)
    || (status.reservedCents !== undefined
      && !isSafeHarnessFundingCents(status.reservedCents))) {
    throw new FatalError('The funding denial did not include exact reservation amounts.')
  }
  return {
    requiredCents: status.requiredCents,
    availableCents: status.remainingCents,
    reservedCents: status.reservedCents,
  }
}

function authorizedTopUpReason(status: Record<string, unknown>) {
  const safeTopUpReasons = new Set([
    'disabled', 'pending', 'payment_failed', 'monthly_limit_reached', 'missing_payment_method',
    'missing_customer', 'missing_consent', 'amount_shortfall', 'not_paid', 'authorization_changed',
    'amount_too_small',
  ])
  return typeof status.topUpReason === 'string' && safeTopUpReasons.has(status.topUpReason)
    ? status.topUpReason : undefined
}

function fundingPause(input: { receiptId: string; status: unknown }): import('@overlay/agent-runtime/harness-state').HarnessFundingPause {
  const status = input.status && typeof input.status === 'object'
    ? input.status as Record<string, unknown> : {}
  const rawReason = typeof status.reason === 'string' ? status.reason : 'insufficient_budget'
  const reason = fundingPauseReason(rawReason)
  const { requiredCents, availableCents, reservedCents } = exactFundingAmounts(status)
  const topUpReason = authorizedTopUpReason(status)
  return { reason, requiredCents, availableCents, ...(reservedCents !== undefined ? { reservedCents } : {}), receiptId: input.receiptId,
    ...(topUpReason ? { autoTopUpReason: topUpReason } : {}) }
}

export type HarnessModelDispatch = {
  access: HarnessExecutionReference & { workspaceId: string }
  receiptId: string
  requestFingerprint: string
  billingProgrammaticSubjectId?: string
  inputTokenBudget: number
  maxOutputTokens: number
  contextWindow: number | null
}

type DispatchAuthority = {
  entitlements: Parameters<typeof reserveProviderBudget>[0]['entitlements']
  requiresZeroDataRetention?: boolean
  billingProgrammaticSubjectId?: string
}

function assertPreparedDispatch(
  reference: HarnessModelReference,
  input: HarnessModelDispatch,
  options: LanguageModelV4CallOptions,
): void {
  if ((reference.personal && reference.native) || reference.credentialOwnerId !== input.access.actorUserId || reference.allowLowBalanceFallback !== false) {
    throw new FatalError('Harness model dispatch identity or routing is invalid.')
  }
  if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0
    || !Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens! <= 0 || options.maxOutputTokens! > input.maxOutputTokens
    || !Number.isSafeInteger(input.inputTokenBudget) || input.inputTokenBudget <= 0
    || estimateHarnessInputTokens(options, input.contextWindow) > input.inputTokenBudget) {
    throw new FatalError('The model call exceeds its prepared token limits.')
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

async function claimModelDispatch(input: HarnessModelDispatch, modelId: string, operationId: string, billingReservationId: string | null): Promise<void> {
  const repository = new ConvexHarnessRepository()
  let claimed = false
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
      operation: { type: 'bind_model_dispatch', id: input.receiptId, modelId, billingReservationId },
    })
    if (result.conflict) continue
    if (!result.applied) throw new FatalError('Model dispatch has already been claimed.')
    claimed = true
    break
  }
  if (!claimed) throw new FatalError('Model dispatch ownership is contended.')
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
  const hold = state?.modelReservation
  if (!state || state.workflowRunId !== input.access.workflowRunId || hold?.id !== input.receiptId || hold.dispatch) {
    throw new FatalError('Model dispatch is missing its hold or has already been attempted.')
  }
  if (state.policy.executionPolicyVersion === 2
    && ((state.policy.spendingMode === 'external') !== isByokModelId(reference.modelId))) {
    throw new FatalError('The model does not match this harness spending mode.')
  }
  const estimate = await forecastHarnessModelCost({ modelId: reference.modelId,
    inputTokenBudget: input.inputTokenBudget, maxOutputTokens: input.maxOutputTokens, cacheWrites: hasHarnessCacheWrites(options) })
  if (estimate > hold.maxCostMicros) throw new FatalError('Model pricing exceeds its authorized hold.')
  if (state.policy.executionPolicyVersion === 2 && state.policy.spendingMode === 'none' && estimate > 0) {
    throw new FatalError('Paid model execution requires workspace funding or external credentials.')
  }
  return {
    state,
    estimate,
    operationId: `harness-model:${createHash('sha256').update(JSON.stringify([input.access.runId, input.receiptId])).digest('hex')}`,
  }
}

async function reserveAuthorizedModelBudget(
  reference: HarnessModelReference,
  input: HarnessModelDispatch,
  refreshed: DispatchAuthority,
  state: NonNullable<Awaited<ReturnType<ConvexHarnessRepository['get']>>>,
  estimate: number,
  operationId: string,
) {
  const usesOverlayBudget = state.policy.executionPolicyVersion !== 2 || state.policy.spendingMode === 'workspace'
  const reservation = usesOverlayBudget ? await reserveProviderBudget({
    userId: input.access.actorUserId, workspaceId: input.access.workspaceId,
    programmaticSubjectId: refreshed.billingProgrammaticSubjectId ?? input.billingProgrammaticSubjectId,
    entitlements: refreshed.entitlements,
    providerCostUsd: estimate / 1_000_000, kind: 'agent', modelId: reference.modelId,
    operationId, reservationId: operationId, requestFingerprint: input.requestFingerprint,
  }) : null
  if (reservation && !reservation.ok) {
    const resourceStatus = (reservation.payload as { resourceStatus?: unknown } | undefined)?.resourceStatus
    if (reservation.code === 'insufficient_budget' && state.policy.executionPolicyVersion === 2
      && state.policy.spendingMode === 'workspace' && resourceStatus) {
      await recordHarnessModelRejection(reference, 'budget')
      const settled = await readHarnessState(input.access)
      if (settled.status !== 'running' || settled.latestReceipt?.id !== input.receiptId) {
        throw new FatalError('The denied model reservation could not be settled safely.')
      }
      await applyHarnessOperation(input.access, `funding-pause:${input.receiptId}`, {
        type: 'pause_for_funding',
        pause: fundingPause({ receiptId: input.receiptId, status: resourceStatus }),
      })
      throw new HarnessYield(input.receiptId)
    }
    await recordHarnessModelRejection(reference, 'budget')
    throw new FatalError(`Model budget reservation declined: ${reservation.code}`)
  }
  return reservation
}

async function bindAndStartModelDispatch(
  input: HarnessModelDispatch,
  reference: HarnessModelReference,
  operationId: string,
  reservation: Awaited<ReturnType<typeof reserveAuthorizedModelBudget>>,
) {
  try {
    await claimModelDispatch(input, reference.modelId, operationId, reservation?.reservationId ?? null)
  } catch (error) {
    if (reservation?.ok) {
      await releaseProviderBudgetReservation({ userId: input.access.actorUserId, reservationId: reservation.reservationId,
        reason: 'Harness dispatch binding failed before provider execution.' })
    }
    throw error
  }
  if (reservation?.ok) {
    await markProviderBudgetStarted({ userId: input.access.actorUserId, reservationId: reservation.reservationId })
  }
}

// Runs inside the actual provider step. No credentials or resolved grants cross
// its durable boundary; a bound dispatch is never automatically sent again.
export async function authorizeHarnessModelDispatch(
  reference: HarnessModelReference,
  options: LanguageModelV4CallOptions,
  input: HarnessModelDispatch,
  authorize: () => Promise<DispatchAuthority>,
): Promise<void> {
  assertPreparedDispatch(reference, input, options)
  const refreshed = await authorize()
  const current = await validateCurrentDispatch(reference, options, input, refreshed)
  const reservation = await reserveAuthorizedModelBudget(
    reference, input, refreshed, current.state, current.estimate, current.operationId,
  )
  await bindAndStartModelDispatch(input, reference, current.operationId, reservation)
}
