import { createOverlayAppClient } from '@overlay/api-client'
import { fetchWithSessionRecovery } from '@/shared/auth/session-fetch'

export const overlayAppClient = createOverlayAppClient({
  fetch: (input, init) => fetchWithSessionRecovery(input, init),
})
