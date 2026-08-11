import 'server-only'

import type { Entitlements } from '@/shared/app/app-contracts'
import {
  billableBudgetCentsFromProviderUsd,
  finalizeProviderBudgetReservation,
  markProviderBudgetReconcile,
  markProviderBudgetStarted,
  reserveProviderBudget,
} from './billing-runtime'

export const AUTOMATION_WORKFLOW_STEPS_PER_RUN_ESTIMATE = 20
export const VERCEL_WORKFLOW_PRICE_USD_PER_100K_STEPS = 2.5
export const AUTOMATION_WORKFLOW_STEP_PROVIDER_COST_USD =
  AUTOMATION_WORKFLOW_STEPS_PER_RUN_ESTIMATE * VERCEL_WORKFLOW_PRICE_USD_PER_100K_STEPS / 100_000

export async function meterAutomationWorkflowRun(args: {
  entitlements: Entitlements
  idempotencyKey?: string | null
  programmaticSubjectId: string
  requestFingerprint: string
  userId: string
  workspaceId: string
}) {
  const reservation = await reserveProviderBudget({
    entitlements: args.entitlements,
    idempotencyKey: args.idempotencyKey,
    kind: 'agent',
    modelId: 'vercel/workflow-steps',
    operationId: 'automation.workflow-run',
    programmaticSubjectId: args.programmaticSubjectId,
    providerCostUsd: AUTOMATION_WORKFLOW_STEP_PROVIDER_COST_USD,
    requestFingerprint: args.requestFingerprint,
    userId: args.userId,
    workspaceId: args.workspaceId,
  })
  if (!reservation.ok) {
    if (reservation.code === 'usage_reservation_replay') {
      return { ok: true, replayed: true } as const
    }
    return reservation
  }

  try {
    await markProviderBudgetStarted({
      reservationId: reservation.reservationId,
      userId: args.userId,
    })
    await finalizeProviderBudgetReservation({
      actualProviderCostUsd: AUTOMATION_WORKFLOW_STEP_PROVIDER_COST_USD,
      events: [{
        cachedTokens: 0,
        cost: billableBudgetCentsFromProviderUsd(AUTOMATION_WORKFLOW_STEP_PROVIDER_COST_USD),
        inputTokens: 0,
        modelId: 'vercel/workflow-steps',
        outputTokens: 0,
        timestamp: Date.now(),
        type: 'agent',
      }],
      reservationId: reservation.reservationId,
      userId: args.userId,
    })
  } catch (error) {
    await markProviderBudgetReconcile({
      errorMessage: error instanceof Error ? error.message : 'automation_workflow_metering_failed',
      reservationId: reservation.reservationId,
      userId: args.userId,
    }).catch((_reconcileError) => undefined)
    throw error
  }
  return { ok: true, replayed: false } as const
}
