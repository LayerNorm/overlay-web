import type { HarnessExecutionPorts } from './ports'
import { createNativeHarnessModelPorts } from './native-model-ports'
import { refreshNativeHarnessAccess, type NativeHarnessAccess, type NativeHarnessContext } from './native-access'
import { createHarnessExecutionPorts, type HarnessSurfacePorts } from './execution-ports'
import type { HarnessModelRouting } from './model-ports'
import { ensurePayerBudgetAvailable } from '@/server/billing/billing-runtime'

export async function authorizeNativeHarnessExecution(access: NativeHarnessAccess, context: NativeHarnessContext, toolName?: string) {
  'use step'
  await refreshNativeHarnessAccess(access, context, toolName, { renewalMode: true, renewLease: true })
}

export async function checkNativeHarnessFunding(access: NativeHarnessAccess, context: NativeHarnessContext, requiredCents: number) {
  'use step'
  const authority = await refreshNativeHarnessAccess(access, context, undefined, { renewalMode: true })
  if (!authority.paid) return false
  const budget = await ensurePayerBudgetAvailable({
    entitlements: authority.entitlements, minimumRequiredCents: requiredCents,
    userId: access.actorUserId, workspaceId: access.workspaceId,
    programmaticSubjectId: authority.billingProgrammaticSubjectId,
  })
  return budget.remainingCents >= requiredCents
}

export function createNativeHarnessExecutionPorts(
  input: { access: NativeHarnessAccess; context: NativeHarnessContext },
  surface: HarnessSurfacePorts,
  routing?: HarnessModelRouting,
): HarnessExecutionPorts {
  return createHarnessExecutionPorts({
    reference: input.access, modelId: input.context.modelId,
    authorize: toolName => authorizeNativeHarnessExecution(input.access, input.context, toolName),
    model: createNativeHarnessModelPorts(input, routing), surface,
  })
}
