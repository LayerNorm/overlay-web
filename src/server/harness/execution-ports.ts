import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionPorts } from './ports'
import { admitHarnessRequestUsage } from './request-usage-step'
import { createHarnessStatePorts } from './state-ports'
import { waitForHarnessModelResources } from './resource-boundary'
import type { HarnessExecutionReference } from './state-steps'

export type HarnessSurfacePorts = Pick<HarnessExecutionPorts,
  'recordToolResult' | 'delegate' | 'readChild' | 'waitForChildren' | 'waitForInput' | 'waitForApproval'>

export function createHarnessExecutionPorts(input: {
  reference: HarnessExecutionReference
  modelId: string
  authorize: (toolName?: string) => Promise<void>
  model: Pick<HarnessExecutionPorts, 'prepareModel' | 'recordModelStep' | 'recoverModelFailure'>
  surface: HarnessSurfacePorts
  // Set when the surface workflow already claimed, authorized and admitted the
  // run in its own steps. The runner's first read then uses this post-claim
  // snapshot and its claim adds no durable steps.
  admitted?: HarnessSnapshot
}): HarnessExecutionPorts {
  const state = createHarnessStatePorts(input.reference)
  let admitted = input.admitted
  return {
    ...input.surface,
    ...state,
    ...input.model,
    read: async () => {
      if (!admitted) return state.read()
      const snapshot = admitted
      admitted = undefined
      return snapshot
    },
    waitForResources: requiredCostMicros => waitForHarnessModelResources(input.reference, requiredCostMicros, state.read),
    claim: async () => {
      if (input.admitted) return true
      if (!await state.claim()) return false
      await input.authorize()
      await admitHarnessRequestUsage(input.reference, input.modelId)
      return true
    },
    authorizeTool: toolName => input.authorize(toolName),
  }
}
