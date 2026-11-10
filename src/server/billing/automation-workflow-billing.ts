import 'server-only'

import { chargeProviderUsage } from './billing-runtime'

/** Each automation run is charged a flat price for its workflow steps, after the run. */
export const AUTOMATION_WORKFLOW_STEPS_PER_RUN = 20
export const VERCEL_WORKFLOW_PRICE_USD_PER_100K_STEPS = 2.5
export const AUTOMATION_WORKFLOW_STEP_PROVIDER_COST_USD =
  AUTOMATION_WORKFLOW_STEPS_PER_RUN * VERCEL_WORKFLOW_PRICE_USD_PER_100K_STEPS / 100_000

/**
 * Charges an automation run's workflow steps once it has run. Nothing is held before the run; the
 * operation id (one per run and turn) keeps a replayed workflow from charging twice.
 */
export async function chargeAutomationWorkflowRun(args: {
  idempotencyKey: string
  programmaticSubjectId: string
  userId: string
  workspaceId: string
}): Promise<void> {
  await chargeProviderUsage({
    operationId: `automation.workflow-run:${args.idempotencyKey}`,
    programmaticSubjectId: args.programmaticSubjectId,
    providerCostUsd: AUTOMATION_WORKFLOW_STEP_PROVIDER_COST_USD,
    usage: { kind: 'agent', modelId: 'vercel/workflow-steps', inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
    userId: args.userId,
    workspaceId: args.workspaceId,
  })
}
