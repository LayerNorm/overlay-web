import { app, BrowserWindow, session, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { serverProfileService } from './security/server-profile-service'
import { startNativeSignIn } from './security/native-auth-service'

export const WEB_SHELL_PARTITION = 'persist:overlay'
export const remoteWindows = new Set<WebContents>()
export const remoteWindowSurfaces = new WeakMap<WebContents, 'main' | 'panel'>()
let mainWindow: BrowserWindow | null = null
export function getMainWindow(): BrowserWindow | undefined {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
}
export function getWebShellOrigin(): string {
  return serverProfileService.getActiveOrigin()
}
export function isWebShellEnabled(): boolean {
  return true
}
const permissions = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen'])
export function sameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === getWebShellOrigin()
  } catch {
    return false
  }
}
export function configureWebSession(): void {
  const partition = session.fromPartition(WEB_SHELL_PARTITION)
  partition.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      remoteWindows.has(contents) &&
        permissions.has(permission) &&
        sameOrigin(contents.getURL()) &&
        details.isMainFrame === true &&
        sameOrigin(details.requestingUrl)
    )
  })
  partition.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    return (
      !!contents &&
      remoteWindows.has(contents) &&
      permissions.has(permission) &&
      sameOrigin(contents.getURL()) &&
      requestingOrigin === getWebShellOrigin() &&
      details.isMainFrame === true
    )
  })
}
/** Keep hosting protection cookies in the same partition as the web window. */
export function startWebShellSignIn(force = false): Promise<void> {
  return startNativeSignIn(force, (url, init) =>
    session.fromPartition(WEB_SHELL_PARTITION).fetch(url, { ...init, redirect: 'error' })
  )
}
export async function openExternally(url: string): Promise<void> {
  const target = new URL(url)
  if (!['https:', 'http:', 'mailto:'].includes(target.protocol))
    throw new Error('unsupported_external_protocol')
  await shell.openExternal(target.href)
}
export function loadWebShell(window: BrowserWindow, route = '/app/work'): void {
  if (!route.includes('surface=panel')) mainWindow = window
  const contents = window.webContents
  remoteWindows.add(contents)
  remoteWindowSurfaces.set(contents, route.includes('surface=panel') ? 'panel' : 'main')
  contents.once('destroyed', () => remoteWindows.delete(contents))
  contents.setWindowOpenHandler(({ url }) => {
    void openExternally(url).catch(() => {})
    return { action: 'deny' }
  })
  const guard = (event: Electron.Event, url: string) => {
    if (sameOrigin(url) && new URL(url).pathname.startsWith('/api/auth/sso/')) {
      event.preventDefault()
      void startWebShellSignIn().catch(() => {})
      return
    }
    // SSO uses the system browser. No remote auth host receives a privileged window.
    if (sameOrigin(url)) return
    event.preventDefault()
    void openExternally(url).catch(() => {})
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (!mainFrame || code === -3) return
    void window.loadFile(join(__dirname, '../renderer/offline.html'), {
      query: { origin: getWebShellOrigin() }
    })
  })
  // The offline document has no bridge and its only link returns to the pinned origin.
  void window.loadURL(new URL(route, getWebShellOrigin()).href).catch(() => {})
}
export function redeemSessionTransferInWebShell(
  window: BrowserWindow,
  token: string,
  verifier: string
): void {
  const url = new URL('/auth/desktop/complete', getWebShellOrigin())
  url.searchParams.set('token', token)
  void window
    .loadURL(url.href, { extraHeaders: `x-overlay-code-verifier: ${verifier}\n` })
    .catch(() => {})
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
export function remotePreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/web-shell.js'),
    partition: WEB_SHELL_PARTITION,
    additionalArguments: [`--overlay-origin=${getWebShellOrigin()}`],
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    devTools: !app.isPackaged
  }
}
