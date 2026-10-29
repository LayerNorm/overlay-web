import type { HarnessExecutionPorts } from './ports'
import { createNativeHarnessModelPorts } from './native-model-ports'
import { refreshNativeHarnessAccess, type NativeHarnessAccess, type NativeHarnessContext } from './native-access'
import { createHarnessExecutionPorts, type HarnessSurfacePorts } from './execution-ports'
import type { HarnessModelRouting } from './model-ports'

async function authorizeNativeHarnessExecution(access: NativeHarnessAccess, context: NativeHarnessContext, toolName?: string) {
  'use step'
  await refreshNativeHarnessAccess(access, context, toolName)
}

export function createNativeHarnessExecutionPorts(
  input: { access: NativeHarnessAccess; context: NativeHarnessContext },
  surface: HarnessSurfacePorts,
  routing?: HarnessModelRouting,
): HarnessExecutionPorts {
  return createHarnessExecutionPorts({
    reference: input.access, modelId: input.context.modelId,
    authorize: toolName => authorizeNativeHarnessExecution(input.access, input.context, toolName),
    model: createNativeHarnessModelPorts(input, routing), surface,
  })
}
