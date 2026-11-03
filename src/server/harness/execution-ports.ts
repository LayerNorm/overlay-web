import type { HarnessExecutionPorts } from './ports'
import { admitHarnessRequestUsage } from './request-usage-step'
import { createHarnessStatePorts } from './state-ports'
import { waitForHarnessModelResources } from './resource-boundary'
import type { HarnessExecutionReference } from './state-steps'

export type HarnessSurfacePorts = Pick<HarnessExecutionPorts,
  'recordToolResult' | 'delegate' | 'readChild' | 'waitForChildren' | 'waitForInput' | 'waitForApproval' | 'waitForFunding' | 'checkFunding'>
  & Partial<Pick<HarnessExecutionPorts, 'continueExecution'>>

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
    renewLease: () => input.authorize(),
    continueExecution: input.surface.continueExecution ?? (async () => {
      throw new Error('HARNESS_CONTINUATION_NOT_CONFIGURED')
    }),
    waitForResources: async requiredCostMicros => {
      await input.authorize()
      return waitForHarnessModelResources(input.reference, requiredCostMicros, state.read)
    },
    waitForChildren: async childRunIds => {
      await input.authorize()
      return input.surface.waitForChildren(childRunIds)
    },
    waitForInput: async current => {
      await input.authorize()
      return input.surface.waitForInput(current)
    },
    waitForApproval: async requests => {
      await input.authorize()
      return input.surface.waitForApproval(requests)
    },
    claim: async () => {
      if (!await state.claim()) return false
      await input.authorize()
      await admitHarnessRequestUsage(input.reference, input.modelId)
      return true
    },
    authorizeTool: toolName => input.authorize(toolName),
  }
}
