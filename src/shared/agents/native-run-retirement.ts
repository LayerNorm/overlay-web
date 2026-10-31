export const NATIVE_RUN_RETIRED_CODE = 'native_runner_retired'
export const NATIVE_RUN_RETIRED_MESSAGE = 'The harness has changed. Start a new thread to continue.'
export const NATIVE_THREAD_COMPATIBILITY_REVISION = 'tracked-native-v1'
export const NATIVE_THREAD_UNAVAILABLE_CODE = 'native_thread_compatibility_unavailable'
export const NATIVE_THREAD_UNAVAILABLE_MESSAGE = 'Thread safety checks are temporarily unavailable. Your history is preserved. Please try again shortly.'

export type NativeThreadCompatibility =
  | { readOnly: false }
  | {
      readOnly: true
      code: typeof NATIVE_RUN_RETIRED_CODE | typeof NATIVE_THREAD_UNAVAILABLE_CODE
      message: string
    }

export function nativeThreadCompatibilityUnavailable(): NativeThreadCompatibility {
  return { readOnly: true, code: NATIVE_THREAD_UNAVAILABLE_CODE, message: NATIVE_THREAD_UNAVAILABLE_MESSAGE }
}

export function nativeThreadUnavailableError(): Error {
  return new Error(`${NATIVE_THREAD_UNAVAILABLE_CODE}: ${NATIVE_THREAD_UNAVAILABLE_MESSAGE}`)
}

export function isNativeThreadUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(`${NATIVE_THREAD_UNAVAILABLE_CODE}:`)
}

type ExecutionIdentity = { runner: string; executionEngine?: string }

export function nativeRunRetiredError(): Error {
  return new Error(`${NATIVE_RUN_RETIRED_CODE}: ${NATIVE_RUN_RETIRED_MESSAGE}`)
}

export function isNativeRunRetiredError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(`${NATIVE_RUN_RETIRED_CODE}:`)
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
