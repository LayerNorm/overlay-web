import type { HarnessExecutionPorts } from './ports'
import type { PersonalHarnessToolsInput } from './personal-tools'
import { refreshPersonalHarnessAccess } from './personal-access'
import { createPersonalHarnessModelPorts } from './personal-model-ports'
import { admitHarnessRequestUsage } from './request-usage-step'
import { createHarnessStatePorts } from './state-steps'

type SurfacePorts = Pick<HarnessExecutionPorts,
  'recordToolResult' | 'delegate' | 'readChild' | 'waitForChildren' | 'waitForInput' | 'waitForApproval'>

export async function authorizePersonalHarnessExecution(
  input: Pick<PersonalHarnessToolsInput, 'access' | 'context'>,
  toolName?: string,
): Promise<void> {
  'use step'
  await refreshPersonalHarnessAccess(input.access, input.context, toolName)
}

// Surface ports supply authenticated delivery, waits and child lifecycle, never
// another model loop or billing implementation.
export function createPersonalHarnessExecutionPorts(
  input: Pick<PersonalHarnessToolsInput, 'access' | 'context'> & { contextBudgetTokens?: number },
  surface: SurfacePorts,
): HarnessExecutionPorts {
  const state = createHarnessStatePorts(input.access)
  return {
    ...surface,
    ...state,
    ...createPersonalHarnessModelPorts(input),
    claim: async () => {
      if (!await state.claim()) return false
      await authorizePersonalHarnessExecution(input)
      await admitHarnessRequestUsage(input.access, input.context.effectiveModelId)
      return true
    },
    authorizeTool: toolName => authorizePersonalHarnessExecution(input, toolName),
  }
}
