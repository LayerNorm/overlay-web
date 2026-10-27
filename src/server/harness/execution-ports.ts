import type { HarnessExecutionPorts } from './ports'
import { admitHarnessRequestUsage } from './request-usage-step'
import { createHarnessStatePorts } from './state-ports'
import type { HarnessExecutionReference } from './state-steps'

export type HarnessSurfacePorts = Pick<HarnessExecutionPorts,
  'recordToolResult' | 'delegate' | 'readChild' | 'waitForChildren' | 'waitForInput' | 'waitForApproval'>

export function createHarnessExecutionPorts(input: {
  reference: HarnessExecutionReference
  modelId: string
  authorize: (toolName?: string) => Promise<void>
  model: Pick<HarnessExecutionPorts, 'prepareModel' | 'recordModelStep' | 'recoverModelFailure'>
  surface: HarnessSurfacePorts
}): HarnessExecutionPorts {
  const state = createHarnessStatePorts(input.reference)
  return {
    ...input.surface,
    ...state,
    ...input.model,
    claim: async () => {
      if (!await state.claim()) return false
      await input.authorize()
      await admitHarnessRequestUsage(input.reference, input.modelId)
      return true
    },
    authorizeTool: toolName => input.authorize(toolName),
  }
}
