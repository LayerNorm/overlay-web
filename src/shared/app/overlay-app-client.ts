import { createOverlayAppClient } from '@overlay/api-client'
import { fetchWithSessionRecovery } from '@/shared/auth/session-fetch'
import { observeNativeThreadSafetyResponse } from '@/shared/chat/native-thread-safety'

export function shouldObserveNativeThreadSafetyResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
): boolean {
  const method = init?.method ?? (
    typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET'
  )
  return method.toUpperCase() !== 'GET'
}

export async function observeNativeThreadSafetyResponseForRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  response: Response,
): Promise<void> {
  if (shouldObserveNativeThreadSafetyResponse(input, init)) {
    await observeNativeThreadSafetyResponse(response)
  }
}

export const overlayAppClient = createOverlayAppClient({
  fetch: async (input, init) => {
    const response = await fetchWithSessionRecovery(input, init)
    await observeNativeThreadSafetyResponseForRequest(input, init, response)
    return response
  },
})
