import { createHarnessModelPorts, type HarnessModelRouting } from './model-ports'
import { preparePersonalHarnessModel } from './model-preparation'
import type { PersonalHarnessToolsInput } from './personal-tools'

export type PersonalHarnessModelRouting = HarnessModelRouting

export function createPersonalHarnessModelPorts(
  input: Pick<PersonalHarnessToolsInput, 'access' | 'context'> & { contextBudgetTokens?: number },
  routing?: PersonalHarnessModelRouting,
) {
  return createHarnessModelPorts({
    reference: input.access,
    modelId: input.context.effectiveModelId,
    contextBudgetTokens: input.contextBudgetTokens,
    prepare: ({ modelId, receiptId, options }) => preparePersonalHarnessModel({
      access: input.access,
      context: { ...input.context, effectiveModelId: modelId },
      receiptId,
      options,
    }),
  }, routing)
}
