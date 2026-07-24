import type { BrowserWindow } from 'electron'

/**
 * Reassert the properties that make the overlay pill a persistent, passive
 * control surface. This intentionally uses showInactive so recovery never
 * steals focus from the user's current application.
 */
export function restorePersistentOverlayWindow(window: BrowserWindow): boolean {
  if (window.isDestroyed()) return false

  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  })
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setIgnoreMouseEvents(true, { forward: true })
  if (!window.isVisible()) window.showInactive()
  return true
}
