import { FatalError } from 'workflow'
import { createHarnessModelPorts, type HarnessModelRouting } from './model-ports'
import { preparePersonalHarnessModel } from './model-preparation'
import type { PersonalHarnessToolsInput } from './personal-tools'
import { waitForHarnessModelResources } from './resource-boundary'
import { readHarnessState } from './state-steps'

export type PersonalHarnessModelRouting = HarnessModelRouting

export function createPersonalHarnessModelPorts(
  input: Pick<PersonalHarnessToolsInput, 'access' | 'context'> & { contextBudgetTokens?: number },
  routing?: PersonalHarnessModelRouting,
) {
  return createHarnessModelPorts({
    reference: input.access,
    modelId: input.context.effectiveModelId,
    contextBudgetTokens: input.contextBudgetTokens,
    prepare: async ({ modelId, receiptId, options }) => {
      while (true) {
        const result = await preparePersonalHarnessModel({
          access: input.access,
          context: { ...input.context, effectiveModelId: modelId },
          receiptId,
          options,
        })
        if (!('code' in result)) return result
        const state = await waitForHarnessModelResources(input.access, 0, () => readHarnessState(input.access))
        if (state.policy.resourcePauseVersion !== 1 || state.status !== 'running') {
          throw new FatalError('Harness model preparation is no longer runnable.')
        }
      }
    },
  }, routing)
}
