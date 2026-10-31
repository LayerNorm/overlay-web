export const NATIVE_RUN_RETIRED_CODE = 'native_runner_retired'
export const NATIVE_RUN_RETIRED_MESSAGE = 'The harness has changed. Start a new thread to continue.'

type ExecutionIdentity = { runner: string; executionEngine?: string }

export function nativeRunRetiredError(): Error {
  return new Error(`${NATIVE_RUN_RETIRED_CODE}: ${NATIVE_RUN_RETIRED_MESSAGE}`)
}

export function isNativeHarnessRun(run: ExecutionIdentity): boolean {
  return run.runner === 'workflow' && run.executionEngine === 'overlay_harness'
}

export function isRetiredNativeRun(run: ExecutionIdentity): boolean {
  return run.runner !== 'remote' && !isNativeHarnessRun(run)
}

export function assertNativeHarnessRun(run: ExecutionIdentity): void {
  if (!isNativeHarnessRun(run)) {
    throw nativeRunRetiredError()
  }
}

export function assertSupportedAgentExecution(run: ExecutionIdentity): void {
  if (isRetiredNativeRun(run)) assertNativeHarnessRun(run)
}
