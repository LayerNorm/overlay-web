import { createHarnessModelPorts } from './model-ports'
import { prepareNativeHarnessModel } from './native-model-preparation'
import type { NativeHarnessAccess, NativeHarnessContext } from './native-access'

export function createNativeHarnessModelPorts(input: {
  access: NativeHarnessAccess
  context: NativeHarnessContext
  contextBudgetTokens?: number
}) {
  return createHarnessModelPorts({
    reference: input.access,
    modelId: input.context.modelId,
    contextBudgetTokens: input.contextBudgetTokens,
    prepare: ({ modelId, receiptId, purpose, publicStreamVersion, continuesPrevious, options }) => prepareNativeHarnessModel({
      access: input.access, context: { ...input.context, modelId }, receiptId, purpose, publicStreamVersion, continuesPrevious, options,
    }),
  })
}
