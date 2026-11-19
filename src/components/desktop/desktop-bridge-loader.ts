import type * as DesktopBridgeContract from '@overlay/desktop-bridge'

let contract: Promise<typeof DesktopBridgeContract> | null = null

/**
 * Loads the desktop bridge contract, and the schema library it carries, only
 * inside the desktop app. Browsers never download it.
 */
export function loadDesktopBridgeContract(): Promise<typeof DesktopBridgeContract> | null {
  if (typeof window === 'undefined' || !(window as { overlayDesktop?: unknown }).overlayDesktop) return null
  contract ??= import('@overlay/desktop-bridge')
  return contract
}

export async function notifyDesktopSignedOut(): Promise<void> {
  try {
    await (await loadDesktopBridgeContract())?.notifyDesktopSignedOut()
  } catch {
    /* Native cleanup must never prevent the normal web sign-out. */
  }
}
