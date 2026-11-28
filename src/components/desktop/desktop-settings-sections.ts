import type { OverlayIconName } from '@overlay/app-core'
import type { Capability } from '@overlay/desktop-bridge'

/**
 * Settings sections only the desktop app has: Desktop, and Import (the same scan as desktop setup's "Bring your
 * setup" step) when the app can scan this computer.
 */
export function desktopSettingsSections(capabilities: readonly Capability[] | undefined): Array<{ id: string; label: string; icon: OverlayIconName; order: number }> {
  if (!capabilities) return []
  return [
    { id: 'desktop', label: 'Desktop', icon: 'laptop', order: 100 },
    ...(capabilities.includes('localSetup') ? [{ id: 'import', label: 'Import', icon: 'import' as const, order: 101 }] : []),
  ]
}
