import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionPorts } from './ports'
import type { PersonalHarnessToolsInput } from './personal-tools'
import { createPersonalHarnessModelPorts, type PersonalHarnessModelRouting } from './personal-model-ports'
import { createHarnessExecutionPorts, type HarnessSurfacePorts } from './execution-ports'

export async function authorizePersonalHarnessExecution(
  input: Pick<PersonalHarnessToolsInput, 'access' | 'context'>,
  toolName?: string,
): Promise<void> {
  'use step'
  const { refreshPersonalHarnessAccess } = await import('./personal-access')
  await refreshPersonalHarnessAccess(input.access, input.context, toolName)
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
  await refreshPersonalHarnessAccess(input.access, input.context)
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
