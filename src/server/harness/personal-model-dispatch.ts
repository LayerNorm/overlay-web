import 'server-only'

import { createHash } from 'node:crypto'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { FatalError } from 'workflow'
import { reserveProviderBudget, markProviderBudgetStarted, releaseProviderBudgetReservation } from '@/server/billing/billing-runtime'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { refreshPersonalHarnessAccess, type PersonalHarnessAccess } from './personal-access'
import { estimateHarnessInputTokens, forecastHarnessModelCost, hasHarnessCacheWrites } from './model-forecast'
import type { HarnessModelReference } from './secure-model'

export type PersonalHarnessModelDispatch = {
  access: PersonalHarnessAccess
  receiptId: string
  memoryEnabled: boolean
  requestFingerprint: string
  billingProgrammaticSubjectId?: string
  inputTokenBudget: number
  maxOutputTokens: number
  contextWindow: number | null
}

// Runs inside the actual provider step. No credentials or resolved grants cross
// its durable boundary; a bound dispatch is never automatically sent again.
export async function authorizePersonalHarnessModelDispatch(reference: HarnessModelReference, options: LanguageModelV4CallOptions): Promise<void> {
  const input = reference.personal
  if (!input || reference.credentialOwnerId !== input.access.actorUserId || reference.allowLowBalanceFallback !== false) {
    throw new FatalError('Personal model dispatch identity or routing is invalid.')
  }
  if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0
    || !Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens! <= 0 || options.maxOutputTokens! > input.maxOutputTokens
    || !Number.isSafeInteger(input.inputTokenBudget) || input.inputTokenBudget <= 0
    || estimateHarnessInputTokens(options, input.contextWindow) > input.inputTokenBudget) {
    throw new FatalError('The model call exceeds its prepared token limits.')
  }
  if (options.tools?.some(tool => tool.type === 'provider')) throw new FatalError('Provider-executed tools require separate spend authorization.')
  for (const routing of [options.providerOptions?.gateway, options.providerOptions?.openrouter]) {
    if (routing?.models !== undefined && (!Array.isArray(routing.models) || routing.models.length > 0)) {
      throw new FatalError('Model fallback must be prepared and authorized before dispatch.')
    }
  }
  const refreshed = await refreshPersonalHarnessAccess(input.access, {
    baseUrl: '', userId: input.access.actorUserId, workspaceId: input.access.workspaceId,
    conversationId: input.access.conversationId, effectiveModelId: reference.modelId,
    turnId: input.receiptId, requestFingerprint: input.requestFingerprint, memoryEnabled: input.memoryEnabled,
    billingProgrammaticSubjectId: input.billingProgrammaticSubjectId, requestedToolIds: [], approvalMode: 'ask',
  })
  const state = await new ConvexHarnessRepository().get({ actorUserId: input.access.actorUserId, runId: input.access.runId })
  const hold = state?.modelReservation
  if (!state || state.workflowRunId !== input.access.workflowRunId || hold?.id !== input.receiptId || hold.dispatch) {
    throw new FatalError('Model dispatch is missing its hold or has already been attempted.')
  }
  const estimate = await forecastHarnessModelCost({ modelId: reference.modelId,
    inputTokenBudget: input.inputTokenBudget, maxOutputTokens: input.maxOutputTokens, cacheWrites: hasHarnessCacheWrites(options) })
  if (estimate > hold.maxCostMicros) throw new FatalError('Model pricing exceeds its authorized hold.')
  const operationId = `harness-model:${createHash('sha256').update(JSON.stringify([input.access.runId, input.receiptId])).digest('hex')}`
  const reservation = await reserveProviderBudget({
    userId: input.access.actorUserId, workspaceId: input.access.workspaceId,
    programmaticSubjectId: input.billingProgrammaticSubjectId, entitlements: refreshed.entitlements,
    providerCostUsd: estimate / 1_000_000, kind: 'agent', modelId: reference.modelId,
    operationId, reservationId: operationId, requestFingerprint: input.requestFingerprint,
  })
  if (!reservation.ok) throw new FatalError(`Model budget reservation declined: ${reservation.code}`)
  try {
    const repository = new ConvexHarnessRepository()
    let claimed = false
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await repository.get({ actorUserId: input.access.actorUserId, runId: input.access.runId })
      if (current?.workflowRunId !== input.access.workflowRunId || current.modelReservation?.id !== input.receiptId || current.modelReservation.dispatch) {
        throw new FatalError('Model dispatch has already been claimed or revoked.')
      }
      const result = await repository.apply({
        actorUserId: input.access.actorUserId, runId: input.access.runId,
        operationId: `${operationId}:dispatch`, expectedRevision: current.revision,
        operation: { type: 'bind_model_dispatch', id: input.receiptId, modelId: reference.modelId, billingReservationId: reservation.reservationId },
      })
      if (result.conflict) continue
      if (!result.applied) throw new FatalError('Model dispatch has already been claimed.')
      claimed = true
      break
    }
    if (!claimed) throw new FatalError('Model dispatch ownership is contended.')
  } catch (error) {
    await releaseProviderBudgetReservation({ userId: input.access.actorUserId, reservationId: reservation.reservationId,
      reason: 'Harness dispatch binding failed before provider execution.' })
    throw error
  }
  await markProviderBudgetStarted({ userId: input.access.actorUserId, reservationId: reservation.reservationId })
}
