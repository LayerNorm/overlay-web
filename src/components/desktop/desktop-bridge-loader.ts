import type * as DesktopBridgeContract from '@overlay/desktop-bridge'

let contract: Promise<typeof DesktopBridgeContract> | null = null

/**
 * Loads the desktop bridge contract, and the schema library it carries, only
 * inside the desktop app. Browsers never download it.
 */
/** True inside the desktop app's windows, without loading the bridge contract. */
export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { overlayDesktop?: unknown }).overlayDesktop)
}

export function loadDesktopBridgeContract(): Promise<typeof DesktopBridgeContract> | null {
  if (!isDesktopShell()) return null
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
