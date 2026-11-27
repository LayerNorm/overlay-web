import { createOverlayAppClient } from '@overlay/api-client'
import { appFetch } from './appApi'

export const mobileOverlayAppClient = createOverlayAppClient({
  fetch: appFetch,
})
