import { createHarnessModelPorts, type HarnessModelRouting } from './model-ports'
import { prepareNativeHarnessModel } from './native-model-preparation'
import type { NativeHarnessAccess, NativeHarnessContext } from './native-access'

export function createNativeHarnessModelPorts(input: {
  access: NativeHarnessAccess
  context: NativeHarnessContext
  contextBudgetTokens?: number
}, routing?: HarnessModelRouting) {
  return createHarnessModelPorts({
    reference: input.access,
    modelId: input.context.modelId,
    contextBudgetTokens: input.contextBudgetTokens,
    prepare: ({ modelId, receiptId, purpose, options }) => prepareNativeHarnessModel({
      access: input.access, context: { ...input.context, modelId }, receiptId, purpose, options,
    }),
  }, routing)
}
