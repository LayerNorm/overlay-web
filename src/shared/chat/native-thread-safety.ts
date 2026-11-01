import {
  NATIVE_RUN_RETIRED_CODE,
  NATIVE_RUN_RETIRED_MESSAGE,
  NATIVE_THREAD_UNAVAILABLE_CODE,
  NATIVE_THREAD_UNAVAILABLE_MESSAGE,
} from '@/shared/agents/native-run-retirement'

export const NATIVE_THREAD_SAFETY_CHANGED = 'overlay:native-thread-safety-changed'

export type NativeThreadSafetyStatus = 'checking' | 'writable' | 'retired' | 'unavailable' | 'error'

export function nativeThreadSafetyErrorStatus(error: unknown): NativeThreadSafetyStatus {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'error'
  return nativeThreadSafetyStatus({ readOnly: true, code: error.code })
}

export function isNativeThreadSafetyError(error: unknown): boolean {
  const status = nativeThreadSafetyErrorStatus(error)
  return status === 'retired' || status === 'unavailable'
}

export function nativeThreadSafetyStatus(value: unknown): NativeThreadSafetyStatus {
  if (!value || typeof value !== 'object' || !('readOnly' in value)) return 'error'
  if (value.readOnly === false) return 'writable'
  if (value.readOnly !== true || !('code' in value)) return 'error'
  if (value.code === NATIVE_RUN_RETIRED_CODE) return 'retired'
  if (value.code === NATIVE_THREAD_UNAVAILABLE_CODE) return 'unavailable'
  return 'error'
}

export function nativeThreadSafetyNotice(status: NativeThreadSafetyStatus): string | null {
  switch (status) {
    case 'writable': return null
    case 'retired': return NATIVE_RUN_RETIRED_MESSAGE
    case 'unavailable': return NATIVE_THREAD_UNAVAILABLE_MESSAGE
    case 'checking': return 'Checking thread safety…'
    case 'error': return 'Could not check this thread. Please try again.'
  }
}

export function notifyNativeThreadSafetyChanged(code: unknown): void {
  if (typeof window === 'undefined') return
  if (code !== NATIVE_RUN_RETIRED_CODE && code !== NATIVE_THREAD_UNAVAILABLE_CODE) return
  // Refetch each visible scope rather than retiring a whole room from a reply error.
  window.dispatchEvent(new Event(NATIVE_THREAD_SAFETY_CHANGED))
}

export async function observeNativeThreadSafetyResponse(response: Response): Promise<void> {
  if (response.status !== 410 && response.status !== 503) return
  const payload: unknown = await response.clone().json().catch(() => null)
  if (payload && typeof payload === 'object' && 'code' in payload) {
    notifyNativeThreadSafetyChanged(payload.code)
  }
}
