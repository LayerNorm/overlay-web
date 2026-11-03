import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionPorts } from './ports'
import type { PersonalHarnessToolsInput } from './personal-tools'
import { createPersonalHarnessModelPorts, type PersonalHarnessModelRouting } from './personal-model-ports'
import { createHarnessExecutionPorts, type HarnessSurfacePorts } from './execution-ports'
import { ensurePayerBudgetAvailable } from '@/server/billing/billing-runtime'
import { refreshPersonalHarnessAccess } from './personal-access'

export async function authorizePersonalHarnessExecution(
  input: Pick<PersonalHarnessToolsInput, 'access' | 'context'>,
  toolName?: string,
  options: { renewLease?: boolean } = {},
): Promise<void> {
  'use step'
  await refreshPersonalHarnessAccess(input.access, input.context, toolName, { renewalMode: true, renewLease: options.renewLease !== false })
}

export async function checkPersonalHarnessFunding(
  input: Pick<PersonalHarnessToolsInput, 'access' | 'context'>,
  requiredCents: number,
): Promise<boolean> {
  'use step'
  const authority = await refreshPersonalHarnessAccess(input.access, input.context, undefined, { renewalMode: true })
  if (!authority.paid) return false
  const budget = await ensurePayerBudgetAvailable({
    entitlements: authority.entitlements, minimumRequiredCents: requiredCents,
    userId: input.access.actorUserId, workspaceId: input.access.workspaceId,
    programmaticSubjectId: authority.billingProgrammaticSubjectId,
  })
  return budget.remainingCents >= requiredCents
}

/**
 * Post-claim admission as one durable boundary: attach root delivery, then
 * reauthorize, then count the request. Each part is idempotent, so a retried
 * step repeats only checks and keyed writes.
 */
export async function admitPersonalHarnessExecution(
  input: Pick<PersonalHarnessToolsInput, 'access' | 'context'>,
  options: { attachDelivery: boolean },
): Promise<void> {
  'use step'
  const [{ attachPersonalDelivery }, { refreshPersonalHarnessAccess }, { recordHarnessRequestUsage }] = await Promise.all([
    import('./personal-delivery-attach'), import('./personal-access'), import('./request-usage'),
  ])
  if (options.attachDelivery) await attachPersonalDelivery(input.access)
  await refreshPersonalHarnessAccess(input.access, input.context, undefined, { renewalMode: true, renewLease: true })
  await recordHarnessRequestUsage(input.access, input.context.effectiveModelId)
}

// Surface ports supply authenticated delivery, waits and child lifecycle, never
// another model loop or billing implementation.
export function createPersonalHarnessExecutionPorts(
  input: Pick<PersonalHarnessToolsInput, 'access' | 'context'> & { contextBudgetTokens?: number },
  surface: HarnessSurfacePorts,
  routing?: PersonalHarnessModelRouting,
  // The post-claim snapshot when the workflow already ran admitPersonalHarnessExecution.
  admitted?: HarnessSnapshot,
): HarnessExecutionPorts {
  return createHarnessExecutionPorts({
    reference: input.access,
    modelId: input.context.effectiveModelId,
    authorize: toolName => authorizePersonalHarnessExecution(input, toolName),
    model: createPersonalHarnessModelPorts(input, routing),
    surface,
    ...(admitted ? { admitted } : {}),
  })
}
