import './bootstrap'
import { migrateLegacyDesktopData } from './services/desktop-migration'
import { app, BrowserWindow } from 'electron'
import {
  configureWebSession,
  getWebShellOrigin,
  loadWebShell,
  remotePreferences,
  redeemSessionTransferInWebShell
} from './services/web-shell'
import { registerDesktopRuntime, initializeUpdates } from './services/desktop-runtime'
import { restorePanelLayout } from './services/desktop-panels'
import { consumeSessionTransferVerifier } from './services/security/native-auth-service'
import { verifyCodeSigning } from './services/security/security-service'
import { initSentry } from './services/sentry'
import { settingsService } from './services/settings-service'
import { isYieldingFocus } from './utils/yield-focus'
let main: BrowserWindow | null = null
function createMain(): BrowserWindow {
  if (main && !main.isDestroyed()) return main
  main = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 760,
    minHeight: 500,
    title: 'Overlay',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 9 },
    backgroundColor: '#202020',
    webPreferences: remotePreferences(),
    show: false
  })
  loadWebShell(main)
  main.once('ready-to-show', () => main?.show())
  main.on('focus', () => main?.webContents.send('overlay-desktop:event', 'window.focus', true))
  main.on('blur', () => main?.webContents.send('overlay-desktop:event', 'window.focus', false))
  return main
}
function deepLink(value: string): void {
  try {
    const url = new URL(value)
    if (url.protocol !== 'overlay:' || url.hostname !== 'auth' || url.pathname !== '/transfer')
      return
    const origin = url.searchParams.get('server'),
      token = url.searchParams.get('token')
    if (!origin || origin !== getWebShellOrigin() || !token || !/^[a-f0-9]{32,256}$/i.test(token))
      return
    const verifier = consumeSessionTransferVerifier(origin)
    if (verifier) redeemSessionTransferInWebShell(createMain(), token, verifier)
  } catch {
    /* Ignore malformed or unsolicited protocol links. */
  }
}
app.on('open-url', (event, url) => {
  event.preventDefault()
  void app.whenReady().then(() => deepLink(url))
})
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith('overlay://'))
    if (link) deepLink(link)
    else {
      createMain().show()
      main?.focus()
    }
  })
  app.whenReady().then(async () => {
    if (app.isPackaged && !(await verifyCodeSigning()).valid) {
      app.quit()
      return
    }
    if (app.isPackaged) app.setAsDefaultProtocolClient('overlay')
    configureWebSession()
    restorePanelLayout()
    settingsService.initializeFromPersistedSettings()
    initSentry()
    await migrateLegacyDesktopData()
    registerDesktopRuntime()
    createMain()
    initializeUpdates()
    app.on('activate', () => {
      if (!isYieldingFocus()) {
        createMain().show()
        main?.focus()
      }
    })
  })
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
