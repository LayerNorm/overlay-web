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
