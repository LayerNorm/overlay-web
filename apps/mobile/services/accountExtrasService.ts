import type { TopUpHistoryItem } from '@overlay/app-core'
import { mobileOverlayAppClient } from './overlayClient'

/**
 * Account billing reads beyond the bootstrap entitlements — currently the
 * top-up history (`/api/topups/history`). Checkout/portal stay web-side (App
 * Store rules); this surface is read-only.
 */

export type { TopUpHistoryItem }

export async function getTopUpHistory(): Promise<TopUpHistoryItem[]> {
  const response = await mobileOverlayAppClient.topUps.history()
  return response.items ?? []
}
