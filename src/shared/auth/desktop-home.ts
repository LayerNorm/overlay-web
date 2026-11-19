/** Where the desktop app shows a signed-out person, instead of the website. */
export const DESKTOP_HOME_PATH = '/auth/desktop'

/**
 * The desktop app's windows identify as `… Overlay/<version> … Electron/<version> …`.
 * Only used to choose which signed-out page to show, never to grant anything.
 */
export function isOverlayDesktopUserAgent(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && /\bOverlay\/\d/.test(userAgent) && /\bElectron\/\d/.test(userAgent))
}
