import type { HarnessExecutionPorts } from './ports'
import { createNativeHarnessModelPorts } from './native-model-ports'
import { refreshNativeHarnessAccess, type NativeHarnessAccess, type NativeHarnessContext } from './native-access'
import { createHarnessExecutionPorts, type HarnessSurfacePorts } from './execution-ports'

export async function authorizeNativeHarnessExecution(
  access: NativeHarnessAccess, context: NativeHarnessContext, toolName?: string, options: { renewLease?: boolean } = {},
) {
  'use step'
  await refreshNativeHarnessAccess(access, context, toolName, { renewalMode: true, renewLease: options.renewLease !== false })
}

export async function renewNativeHarnessWait(access: NativeHarnessAccess, context: NativeHarnessContext): Promise<void> {
  'use step'
  await refreshNativeHarnessAccess(access, context, undefined, { renewalMode: true, renewLease: true })
}

export function createNativeHarnessExecutionPorts(
  input: { access: NativeHarnessAccess; context: NativeHarnessContext },
  surface: HarnessSurfacePorts,
): HarnessExecutionPorts {
  return createHarnessExecutionPorts({
    reference: input.access, modelId: input.context.modelId,
    authorize: toolName => authorizeNativeHarnessExecution(input.access, input.context, toolName),
    model: createNativeHarnessModelPorts(input), surface,
  })
}
