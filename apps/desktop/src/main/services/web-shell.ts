import { app, BrowserWindow, session, shell, type Session, type WebContents } from 'electron'
import { serverProfileService } from './security/server-profile-service'

/**
 * Phase 0 spike of internal/plans/DESKTOP_WEB_SHELL_PLAN.md (overlay-web):
 * the main window loads the Overlay web app instead of the local renderer.
 *
 * Security posture for remote content (review before widening):
 * - No preload, so the page gets no IPC or Node surface at all.
 * - Its own persistent partition, separate from the app and browser sessions.
 * - Only same-origin navigation stays in the window; sign-in pages are allowed
 *   while signing in; every other URL opens in the system browser.
 * - Permissions are granted only to the server origin, and only those the web
 *   app uses.
 */

export const WEB_SHELL_PARTITION = 'persist:overlay'

const SIGN_IN_HOST_SUFFIXES = ['.workos.com', '.authkit.app']

const GRANTED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen'
])

// The window hides its title bar, so the sidebar leaves room for the traffic
// lights and the strip above it drags the window. Phase 2 replaces this with
// web shell styles keyed on the bridge.
const TITLE_BAR_CSS = `
aside[aria-label="Sidebar"] { padding-top: 28px; }
aside[aria-label="Sidebar"]::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 28px;
  -webkit-app-region: drag;
}
`

export function isWebShellEnabled(): boolean {
  return process.env['OVERLAY_WEB_SHELL'] === '1'
}

export function getWebShellOrigin(): string {
  const url = new URL(serverProfileService.getActiveOrigin())
  const isLocalDevelopment =
    !app.isPackaged &&
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (url.protocol !== 'https:' && !isLocalDevelopment) {
    throw new Error('web_shell_insecure_server_origin')
  }
  return url.origin
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

function isSignInUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && SIGN_IN_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  } catch {
    return false
  }
}

function openExternally(url: string): void {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:') {
      void shell.openExternal(url)
    }
  } catch {
    // Ignore malformed URLs.
  }
}

function hardenNavigation(webContents: WebContents, origin: string): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, origin)) {
      void webContents.loadURL(url)
    } else {
      openExternally(url)
    }
    return { action: 'deny' }
  })

  const guard = (event: Electron.Event, url: string): void => {
    if (isSameOrigin(url, origin) || isSignInUrl(url)) return
    event.preventDefault()
    openExternally(url)
  }
  webContents.on('will-navigate', guard)
  webContents.on('will-redirect', guard)
  webContents.on('will-attach-webview', (event) => event.preventDefault())
}

let permissionsConfigured = false

function configurePermissions(partition: Session, origin: string): void {
  if (permissionsConfigured) return
  permissionsConfigured = true
  partition.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(GRANTED_PERMISSIONS.has(permission) && isSameOrigin(webContents.getURL(), origin))
  })
  partition.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return GRANTED_PERMISSIONS.has(permission) && requestingOrigin === origin
  })
}

/** Points an already-constructed main window at the web app. */
export function loadWebShell(window: BrowserWindow): void {
  const origin = getWebShellOrigin()
  configurePermissions(session.fromPartition(WEB_SHELL_PARTITION), origin)
  hardenNavigation(window.webContents, origin)
  window.webContents.on('dom-ready', () => {
    void window.webContents.insertCSS(TITLE_BAR_CSS)
  })
  console.log(`[WebShell] Loading ${origin}/app`)
  void window.loadURL(`${origin}/app`)
}
