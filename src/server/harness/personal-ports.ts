import type { HarnessExecutionPorts } from './ports'
import type { PersonalHarnessToolsInput } from './personal-tools'
import { createPersonalHarnessModelPorts, type PersonalHarnessModelRouting } from './personal-model-ports'
import { createHarnessExecutionPorts, type HarnessSurfacePorts } from './execution-ports'
import { ensurePayerBudgetAvailable } from '@/server/billing/billing-runtime'
import { refreshPersonalHarnessAccess } from './personal-access'

export async function authorizePersonalHarnessExecution(
  input: Pick<PersonalHarnessToolsInput, 'access' | 'context'>,
  toolName?: string,
): Promise<void> {
  'use step'
  await refreshPersonalHarnessAccess(input.access, input.context, toolName, { renewalMode: true, renewLease: true })
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

// Surface ports supply authenticated delivery, waits and child lifecycle, never
// another model loop or billing implementation.
export function createPersonalHarnessExecutionPorts(
  input: Pick<PersonalHarnessToolsInput, 'access' | 'context'> & { contextBudgetTokens?: number },
  surface: HarnessSurfacePorts,
  routing?: PersonalHarnessModelRouting,
): HarnessExecutionPorts {
  return createHarnessExecutionPorts({
    reference: input.access,
    modelId: input.context.effectiveModelId,
    authorize: toolName => authorizePersonalHarnessExecution(input, toolName),
    model: createPersonalHarnessModelPorts(input, routing),
    surface,
  })
}
