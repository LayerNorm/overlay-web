// Load environment variables FIRST, before any other imports
import { config } from 'dotenv'
import { join, resolve } from 'path'
config({ path: join(__dirname, '../../.env') })
config({ path: join(__dirname, '../../.env.local') })

console.log('[Startup] Main process starting...', new Date().toISOString())
import {
  app,
  BrowserWindow,
  dialog,
  Tray,
  Menu,
  nativeImage,
  systemPreferences,
  powerMonitor,
  protocol,
  session
} from 'electron'
import { ipcMain, isTrustedRendererUrl } from './services/security/secure-ipc-main'
import { execSync, exec } from 'child_process'

// Keep userData at ~/Library/Application Support/Overlay when npm package name is overlay-desktop
// (same directory as the previous lowercase 'overlay' on case-insensitive macOS filesystems)
app.setName('Overlay')
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'overlay-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])
const isChatParityFixtureMode = !app.isPackaged && process.env.OVERLAY_CHAT_PARITY_FIXTURE === '1'
const isFileParityFixtureMode = !app.isPackaged && process.env.OVERLAY_FILE_PARITY_FIXTURE === '1'
const isParityFixtureMode = isChatParityFixtureMode || isFileParityFixtureMode
import { getResourcePath } from './utils/resources'
import { electronApp } from '@electron-toolkit/utils'
import { autoUpdaterService } from './services/auto-updater'

// Register overlay:// protocol for OAuth callbacks
// Use !app.isPackaged (reliable) instead of process.defaultApp (unreliable in electron-vite)
if (!app.isPackaged && !isParityFixtureMode) {
  // Dev mode: pass the app entry path so macOS re-launches with the correct command,
  // letting requestSingleInstanceLock route the deep link to the running instance.
  const appPath = process.argv[1] ? resolve(process.argv[1]) : ''
  if (appPath) {
    const registered = app.setAsDefaultProtocolClient('overlay', process.execPath, [appPath])
    console.log('[Auth] Protocol registration (dev mode):', registered ? 'SUCCESS' : 'FAILED')
    console.log('[Auth] execPath:', process.execPath)
    console.log('[Auth] appPath:', appPath)
  } else {
    const registered = app.setAsDefaultProtocolClient('overlay')
    console.log(
      '[Auth] Protocol registration (dev mode, no argv[1]):',
      registered ? 'SUCCESS' : 'FAILED'
    )
  }
} else if (app.isPackaged) {
  const registered = app.setAsDefaultProtocolClient('overlay')
  console.log('[Auth] Protocol registration (prod mode):', registered ? 'SUCCESS' : 'FAILED')
}
if (!isParityFixtureMode) {
  console.log('[Auth] Is default protocol client:', app.isDefaultProtocolClient('overlay'))
  console.log('[Auth] Registered overlay:// protocol handler')
}

// Services
import { settingsService } from './services/settings-service'
import { windowManager } from './services/window-manager'
import { panelManager } from './services/panel-manager'
import { systemUtils } from './services/system-utils'
import { panelLatencyMarkDetectEditingDone } from './utils/panel-latency'
import { isYieldingFocus } from './utils/yield-focus'
import { hotkeyManager, HotkeyMode, hasAccessibilityPermission } from './services/hotkey-manager'
import type { PanelToggleMode } from './services/hotkey-manager'
import { registerBrowserIPC } from './services/browser-manager'
import { whisperKitService } from './services/whisperkit-service'
import { parakeetService } from './services/parakeet-service'
import { nativeAudioCaptureService } from './services/native-audio-capture-service'
import { subscriptionService } from './services/subscription-service'
import { keyCacheService } from './services/key-cache-service'
import { resetProviders as resetGatewayProvider } from './services/ai/gateway-provider'

// IPC Handlers
import { registerAllIPC } from './ipc'
import {
  setPanelTranscriptionDestination,
  clearPanelTranscriptionDestination
} from './ipc/panel-ipc'

// Security
import { verifyCodeSigning, auditLogger } from './services/security/security-service'
import { safeStorageService } from './services/security/safe-storage-service'
import type { AuthSession } from './services/security/safe-storage-service'
import {
  cancelPendingNativeAuth,
  completeNativeSignIn,
  consumeSessionTransferVerifier,
  startNativeSignIn
} from './services/security/native-auth-service'
import {
  serverProfileService,
  normalizeServerOrigin,
  type OverlayServerProfile
} from './services/security/server-profile-service'
import { agentApprovalCoordinator } from './services/security/agent-policy/approval-coordinator'

import { initSentry } from './services/sentry'

const getLocalService = (modelId: string): typeof parakeetService | typeof whisperKitService => {
  if (modelId.startsWith('parakeet_')) {
    return parakeetService
  }
  return whisperKitService
}

async function activateAuthenticatedSession(session: AuthSession): Promise<void> {
  settingsService.isAuthenticated = true
  keyCacheService.setAccessToken(session.accessToken)
  scheduleTokenRefresh()
  await keyCacheService.loadUserOwnedKeys()

  const { initComposioKey } = await import('./services/agent/composio-service')
  await initComposioKey()
  const { chatService } = await import('./services/chat-service')
  chatService.refreshProviders()

  subscriptionService.setUserId(session.user.id)
  await subscriptionService.refresh()
}

function deactivateAuthenticatedSession(): void {
  cancelTokenRefresh()
  agentApprovalCoordinator.revokeAll()
  settingsService.isAuthenticated = false
  keyCacheService.invalidateSession()
  resetGatewayProvider()
  subscriptionService.clearUserId()
  panelManager.closeAllPanels()
}

let tokenRefreshTimeout: NodeJS.Timeout | null = null
const TOKEN_REFRESH_INTERVAL_MS = 55 * 60 * 1000 // Access tokens expire at 60 minutes
const TOKEN_REFRESH_RETRY_MS = 5 * 60 * 1000

function scheduleTokenRefresh(delayMs = TOKEN_REFRESH_INTERVAL_MS): void {
  if (tokenRefreshTimeout) clearTimeout(tokenRefreshTimeout)

  const session = safeStorageService.getAuthSession()
  if (!session?.refreshToken) {
    tokenRefreshTimeout = null
    console.log('[Auth] No session to schedule refresh for')
    return
  }

  console.log('[Auth] Scheduling token refresh in', Math.round(delayMs / 60000), 'minutes')
  tokenRefreshTimeout = setTimeout(async () => {
    tokenRefreshTimeout = null
    console.log('[Auth] Performing scheduled token refresh...')
    try {
      const refreshed = await keyCacheService.refreshAccessTokenIfPossible()
      if (refreshed) {
        console.log('[Auth] Scheduled token refresh successful')
        scheduleTokenRefresh()
      } else if (safeStorageService.getAuthSession()) {
        console.warn('[Auth] Scheduled token refresh deferred; preserving session and retrying')
        scheduleTokenRefresh(TOKEN_REFRESH_RETRY_MS)
      }
    } catch (error) {
      const errorCode = error instanceof Error ? error.name : 'unknown_error'
      console.error('[Auth] Scheduled token refresh error:', errorCode)
      if (safeStorageService.getAuthSession()) {
        scheduleTokenRefresh(TOKEN_REFRESH_RETRY_MS)
      }
    }
  }, delayMs)
}

function cancelTokenRefresh(): void {
  if (!tokenRefreshTimeout) return
  clearTimeout(tokenRefreshTimeout)
  tokenRefreshTimeout = null
  console.log('[Auth] Cancelled scheduled token refresh')
}

let nativeHotkeyStart: Promise<Awaited<ReturnType<typeof nativeAudioCaptureService.start>>> | null =
  null
let nativeHotkeyCaptureActive = false

// Recording event handlers
const handleRecordingStart = async (mode: HotkeyMode): Promise<void> => {
  console.log(`[Main] Recording started: ${mode}`)
  settingsService.lastRecordingMode = mode
  nativeHotkeyStart = nativeAudioCaptureService.start()

  // Handle assistant mode context capture
  if (mode === 'assistant') {
    try {
      const context = await systemUtils.detectEditingMode()
      settingsService.selectedTextBeforeRecording = context.isEditing ? context.selectedText : null
      console.log('Assistant mode context:', {
        isEditing: context.isEditing,
        textLength: context.selectedText.length
      })
    } catch (error) {
      console.error('Failed to detect editing mode:', error)
      settingsService.selectedTextBeforeRecording = null
    }
  }

  const nativeStart = await nativeHotkeyStart
  nativeHotkeyCaptureActive = nativeStart.started

  // The native recorder starts before the renderer is notified, so audio
  // capture is already underway while the pill paints.
  windowManager.broadcastToAllWindows('record:start', {
    nativeCapture: nativeStart.started,
    error: nativeStart.error
  })

  systemUtils.playSound('bong.mp3', 0.1, settingsService.soundEffectsEnabled)

  // Auto-mute system volume on macOS
  if (settingsService.autoMuteEnabled && process.platform === 'darwin') {
    systemUtils
      .getMacVolume()
      .then((volume) => {
        settingsService.previousVolume = volume
        return systemUtils.setMacVolume(0)
      })
      .catch((error) => {
        console.error('Failed to mute system volume:', error)
      })
  }
}

const handleRecordingStop = async (_mode: HotkeyMode): Promise<void> => {
  console.log(`[Main] Recording stopped: ${_mode}`)

  const nativeStart = nativeHotkeyStart ? await nativeHotkeyStart : null
  nativeHotkeyStart = null
  let nativeRecording: Awaited<ReturnType<typeof nativeAudioCaptureService.stop>> | undefined
  let nativeError: string | undefined
  if (nativeHotkeyCaptureActive || nativeStart?.started) {
    try {
      nativeRecording = await nativeAudioCaptureService.stop()
    } catch (error) {
      nativeError = error instanceof Error ? error.message : 'native_stop_failed'
      console.error('[NativeAudio] Failed to finish hotkey recording:', nativeError)
    }
  }
  nativeHotkeyCaptureActive = false

  // Notify all windows only after the native file has closed and is ready for
  // the existing transcription pipeline.
  windowManager.broadcastToAllWindows('record:stop', {
    nativeRecording,
    error: nativeError
  })

  systemUtils.playSound('bing.mp3', 0.1, settingsService.soundEffectsEnabled)

  // Restore system volume on macOS
  if (settingsService.autoMuteEnabled && process.platform === 'darwin') {
    systemUtils.setMacVolume(settingsService.previousVolume).catch((error) => {
      console.error('Failed to restore system volume:', error)
    })
  }
}

const handleRecordingCancel = async (_mode: HotkeyMode): Promise<void> => {
  console.log(`[Main] Recording canceled (quick release): ${_mode}`)

  const nativeStart = nativeHotkeyStart ? await nativeHotkeyStart : null
  nativeHotkeyStart = null
  if (nativeHotkeyCaptureActive || nativeStart?.started) {
    await nativeAudioCaptureService.cancel().catch((error) => {
      console.warn('[NativeAudio] Failed to cancel hotkey recording:', error)
    })
  }
  nativeHotkeyCaptureActive = false

  // Notify all windows to cancel recording (won't send to API)
  windowManager.broadcastToAllWindows('record:cancel', {
    nativeCapture: nativeStart?.started === true
  })

  // Don't play the stop sound for canceled recordings
  // Just restore system volume if needed
  if (settingsService.autoMuteEnabled && process.platform === 'darwin') {
    systemUtils.setMacVolume(settingsService.previousVolume).catch((error) => {
      console.error('Failed to restore system volume:', error)
    })
  }
}

// --- Shared hotkey system setup (single source of truth) ---

let selectionInjectGeneration = 0

function cancelSelectedTextInject(): void {
  selectionInjectGeneration++
}

async function injectSelectedTextIntoPanel(panel: 'chat' | 'notebook'): Promise<void> {
  const generation = ++selectionInjectGeneration
  try {
    // Let a rapid hide cancel before we run Cmd+C / osascript.
    await new Promise((resolve) => setTimeout(resolve, 80))
    if (generation !== selectionInjectGeneration) return
    if (!panelManager.isPanelTypeVisible(panel)) return

    const context = await systemUtils.detectEditingMode()
    panelLatencyMarkDetectEditingDone(panel)
    if (generation !== selectionInjectGeneration) return
    if (!panelManager.isPanelTypeVisible(panel)) return
    if (!context.isEditing || !context.selectedText.trim()) return

    const channel = panel === 'chat' ? 'chat:new-with-text' : 'notebook:new-with-text'
    const panelWindow = windowManager.findWindowByType(panel)
    if (!panelWindow) return

    const send = (): void => {
      if (generation !== selectionInjectGeneration) return
      if (!panelManager.isPanelTypeVisible(panel)) return
      panelWindow.webContents.send(channel, context.selectedText)
    }
    if (panelWindow.webContents.isLoading()) {
      panelWindow.webContents.once('did-finish-load', () => {
        setTimeout(send, 50)
      })
    } else {
      setTimeout(send, 50)
    }
  } catch (error) {
    console.error('[Panel] Failed to detect selected text:', error)
  }
}

const handlePanelToggle = (panel: PanelToggleMode): void => {
  const existingPanel = windowManager.findWindowByType(panel)
  const isOpening = !existingPanel || !existingPanel.isVisible()

  if (panel === 'chat' && isOpening) {
    if (existingPanel?.isVisible()) {
      void injectSelectedTextIntoPanel('chat')
      return
    }
    panelManager.togglePanelVisibility('chat')
    void injectSelectedTextIntoPanel('chat')
    return
  }

  if (panel === 'chat' || panel === 'notebook') {
    const result = panelManager.togglePanelVisibility(panel)
    console.log(`[Hotkey] Panel toggle: ${panel}, result: ${result.action}, count: ${result.count}`)
  } else {
    if (existingPanel) {
      if (existingPanel.isVisible()) {
        panelManager.closePanelWindow(panel)
      } else {
        panelManager.showPanelWindow(existingPanel)
      }
    } else {
      panelManager.createPanelWindow(panel)
    }
  }
}

const handlePanelRecordingStart = async (panel: PanelToggleMode): Promise<void> => {
  const allWindows = panelManager.getAllPanelWindows(panel)
  const wasVisible = allWindows.some((win) => win.isVisible())
  hotkeyManager.setPanelWasVisible(wasVisible)
  if (!wasVisible) {
    console.log(`[Main] Panel ${panel} was hidden, opening for transcription`)
    panelManager.togglePanelVisibility(panel)
  }
  if (panel === 'chat' || panel === 'notebook') {
    setPanelTranscriptionDestination(panel, wasVisible)
  }
  console.log(`[Main] Panel ${panel} recording started, wasVisible: ${wasVisible}`)
}

const handlePanelRecordingStop = async (
  panel: PanelToggleMode,
  wasVisible: boolean
): Promise<void> => {
  console.log(`[Main] Panel ${panel} recording stopped, wasVisible: ${wasVisible}`)
}

const handlePanelQuickToggle = (panel: PanelToggleMode): void => {
  console.log(`[Main] Panel ${panel} quick toggle`)
  clearPanelTranscriptionDestination()

  if (panel === 'chat' || panel === 'notebook') {
    const result = panelManager.togglePanelVisibility(panel)
    if (result.action === 'hidden') {
      cancelSelectedTextInject()
    } else {
      void injectSelectedTextIntoPanel(panel)
    }
    return
  }

  panelManager.togglePanelVisibility(panel)
}

const handlePanelShow = (panel: PanelToggleMode): void => {
  console.log(`[Main] Panel ${panel} show`)
  clearPanelTranscriptionDestination()
  if (panel === 'chat' || panel === 'notebook' || panel === 'browser') {
    panelManager.showPanelType(panel)
    if (panel === 'chat' || panel === 'notebook') {
      void injectSelectedTextIntoPanel(panel)
    }
  }
}

const handlePanelHide = (panel: PanelToggleMode): void => {
  console.log(`[Main] Panel ${panel} hide`)
  clearPanelTranscriptionDestination()
  if (panel === 'chat' || panel === 'notebook') {
    cancelSelectedTextInject()
  }
  if (panel === 'chat' || panel === 'notebook' || panel === 'browser') {
    panelManager.hidePanelType(panel)
  }
}

let hotkeyRecoveryTimeout: ReturnType<typeof setTimeout> | null = null
let hotkeyHealthCheckInterval: ReturnType<typeof setInterval> | null = null
let tray: Tray | null = null
let shutdownStarted = false
/** False until initial launch finishes — blocks macOS `activate` from focusing main. */
let appLaunchSettled = false

function beginShutdown(): void {
  if (shutdownStarted) return
  shutdownStarted = true

  if (hotkeyRecoveryTimeout) clearTimeout(hotkeyRecoveryTimeout)
  if (hotkeyHealthCheckInterval) clearInterval(hotkeyHealthCheckInterval)
  hotkeyManager.unregisterAll()
  nativeAudioCaptureService.terminate()
  parakeetService.stopServer()
  whisperKitService.stopServer()

  // Do not start an unbounded network flush while Electron is already exiting.
  // Hosted usage is authoritative; local pending events are advisory.
  void subscriptionService.shutdown({ flushPendingEvents: false })

  // Do not call Tray.destroy() here. Electron 39 can block inside the native
  // status-item teardown during app termination; process exit removes it.
  tray = null

  // A hidden native NSAlert can keep macOS inside a nested modal loop after
  // Electron receives Quit. Cleanup is complete, so terminate this exact
  // process even when that modal loop refuses to unwind.
  if (process.platform === 'darwin') {
    process.kill(process.pid, 'SIGKILL')
  }

  // Other platforms do not need the macOS modal-loop escape hatch.
  process.exit(0)
}

function scheduleHotkeyRecovery(reason: string): void {
  if (hotkeyRecoveryTimeout) clearTimeout(hotkeyRecoveryTimeout)
  hotkeyRecoveryTimeout = setTimeout(() => {
    hotkeyRecoveryTimeout = null
    if (!hotkeyManager.isInitialized()) return
    console.log(`[Main] Recovering hotkeys after ${reason}`)
    clearPanelTranscriptionDestination()
    hotkeyManager.recoverHotkeys()
  }, 750)
}

function setupHotkeySystem(options: { registerPanelHotkeys?: boolean } = {}): void {
  if (!hotkeyManager.isInitialized()) {
    hotkeyManager.initialize({
      onRecordingStart: handleRecordingStart,
      onRecordingStop: handleRecordingStop,
      onRecordingCancel: handleRecordingCancel
    })
  }

  hotkeyManager.initializePanelCallbacks({
    onPanelToggle: handlePanelToggle
  })

  hotkeyManager.registerHotkey('transcription', 'Option ⌥ + Space ␣')
  hotkeyManager.registerHotkey('push-to-talk', 'Option ⌥ + Space ␣')
  hotkeyManager.registerHotkey('assistant', 'Ctrl ⌃ + A')

  if (options.registerPanelHotkeys) {
    hotkeyManager.registerPanelHotkey('chat', 'Cmd ⌘ + .')
    hotkeyManager.registerPanelHotkey('notebook', 'Cmd ⌘ + /')
    hotkeyManager.registerPanelHotkey('browser', 'Cmd ⌘ + \\')
    console.log('[Main] Registered default panel hotkeys')
  }

  hotkeyManager.initializePanelTranscribeCallbacks({
    onPanelRecordingStart: handlePanelRecordingStart,
    onPanelRecordingStop: handlePanelRecordingStop,
    onPanelQuickToggle: handlePanelQuickToggle,
    isPanelVisible: (panel) => panelManager.isPanelTypeVisible(panel),
    showPanel: handlePanelShow,
    hidePanel: handlePanelHide
  })
}

// Handle deep link on macOS (when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault()
  console.log('[Auth] Received deep link')
  void handleAuthCallback(url)
})
// Handle deep link on macOS (when app is launched via protocol)
const gotTheLock = isParityFixtureMode || app.requestSingleInstanceLock()
if (!gotTheLock) {
  console.error(
    '[Startup] Another Overlay instance is already running. Quit the existing Overlay/Electron app before running npm run dev.'
  )
  app.exit(1)
} else if (!isParityFixtureMode) {
  app.on('second-instance', (_event, commandLine) => {
    // Someone tried to run a second instance, we should focus our window
    const mainWindow = windowManager.findWindowByType('main')
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    // Handle the deep link URL (last argument on Windows/Linux)
    const url = commandLine.find((arg) => arg.startsWith('overlay://'))
    if (url) {
      console.log('[Auth] Received deep link from second instance')
      void handleAuthCallback(url)
    }
  })
}

// Process deep link URL - handles auth callbacks and subscription updates
async function handleAuthCallback(url: string): Promise<void> {
  try {
    const urlObj = new URL(url)
    if (urlObj.protocol !== 'overlay:' || urlObj.username || urlObj.password || urlObj.hash) {
      throw new Error('invalid_deep_link_origin')
    }
    const host = urlObj.hostname
    const path = urlObj.pathname

    // Handle subscription-updated deep link
    if (host === 'subscription-updated' && (path === '' || path === '/')) {
      console.log('[DeepLink] Subscription update notification received')
      void handleSubscriptionUpdated()
      return
    }

    // Handle session transfer from landing page (overlay://auth/transfer?token=...)
    // This allows the landing page to pass a short-lived token that we use to fetch the session
    if (host === 'auth' && path === '/transfer') {
      const token = urlObj.searchParams.get('token')
      const server = urlObj.searchParams.get('server')
      if (token && /^[a-f0-9]{32}$/i.test(token) && (!server || server.length <= 2048)) {
        console.log('[Auth] Session transfer request received')
        void handleSessionTransferWithToken(token, server)
        return
      }
      throw new Error('invalid_session_transfer_link')
    }

    if (host !== 'auth' || path !== '/callback') {
      throw new Error('unsupported_deep_link')
    }

    // Handle auth callback (default - OAuth code exchange)
    const code = urlObj.searchParams.get('code')
    const error = urlObj.searchParams.get('error')
    const errorDescription = urlObj.searchParams.get('error_description')
    const state = urlObj.searchParams.get('state')

    const mainWindow = windowManager.findWindowByType('main')

    if (mainWindow) {
      if (error) {
        console.error('[Auth] OAuth provider returned an error')
        mainWindow.webContents.send('auth:error', {
          error: error.slice(0, 128),
          errorDescription: errorDescription?.slice(0, 512)
        })
      } else if (code && state) {
        try {
          const session = await completeNativeSignIn(code, state)
          await activateAuthenticatedSession(session)
          mainWindow.webContents.send(
            'auth:session-transfer',
            safeStorageService.getAuthSessionMetadata()
          )
        } catch (authError) {
          console.error('[Auth] Native callback failed:', authError)
          mainWindow.webContents.send('auth:error', { error: 'native_auth_failed' })
        }
      }
      mainWindow.show()
      mainWindow.focus()
    } else {
      console.error('[Auth] ERROR: No main window found!')
    }
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z0-9_:-]{1,120}$/i.test(error.message)
        ? error.message
        : 'invalid_deep_link'
    console.error('[DeepLink] Rejected:', code)
  }
}

// Handle session transfer using a short-lived token - fetches session data from server
function resolveSessionTransferBaseUrl(serverUrl?: string | null): string {
  const configuredOrigin = serverProfileService.getActiveOrigin()
  if (serverUrl && new URL(serverUrl).origin !== configuredOrigin) {
    throw new Error('session_transfer_server_mismatch')
  }
  return configuredOrigin
}

async function handleSessionTransferWithToken(
  token: string,
  serverUrl?: string | null
): Promise<void> {
  try {
    // Determine the base URL based on environment (respects APP_SERVER_URL for dev→prod testing)
    const baseUrl = resolveSessionTransferBaseUrl(serverUrl)
    const codeVerifier =
      consumeSessionTransferVerifier(baseUrl) ||
      safeStorageService.getSecureValue('session-transfer-verifier')?.trim() ||
      null

    console.log('[Auth] Redeeming one-time desktop session transfer')

    // Fetch the session data from the server
    const response = await fetch(`${baseUrl}/api/auth/desktop-link?token=${token}`, {
      headers: codeVerifier
        ? {
            'x-overlay-code-verifier': codeVerifier
          }
        : undefined
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('[Auth] Failed to fetch session data:', response.status, errorData)
      return
    }

    const authData = (await response.json()) as {
      accessToken?: unknown
      refreshToken?: unknown
      expiresAt?: unknown
      userId?: unknown
      email?: unknown
      firstName?: unknown
      lastName?: unknown
    }
    if (
      typeof authData.accessToken !== 'string' ||
      !authData.accessToken ||
      typeof authData.refreshToken !== 'string' ||
      !authData.refreshToken ||
      typeof authData.userId !== 'string' ||
      !authData.userId ||
      typeof authData.email !== 'string' ||
      !authData.email
    ) {
      console.error('[Auth] Session transfer returned an invalid session payload')
      return
    }

    const transferredSession = {
      accessToken: authData.accessToken,
      refreshToken: authData.refreshToken,
      expiresAt: typeof authData.expiresAt === 'number' ? authData.expiresAt : undefined,
      user: {
        id: authData.userId,
        email: authData.email,
        firstName: typeof authData.firstName === 'string' ? authData.firstName : '',
        lastName: typeof authData.lastName === 'string' ? authData.lastName : ''
      }
    }

    // Persist before notifying any renderer. Deep links can arrive while the
    // main window is still being created, so renderer-only storage can lose a
    // successful handoff and leave the next launch signed out.
    if (!safeStorageService.storeAuthSession(transferredSession)) {
      console.error('[Auth] Failed to persist transferred session securely')
      const mainWindow = windowManager.findWindowByType('main')
      mainWindow?.webContents.send('auth:error', {
        error: 'native_auth_secure_storage_unavailable'
      })
      return
    }

    await activateAuthenticatedSession(transferredSession)
    if (codeVerifier) {
      safeStorageService.deleteSecureValue('session-transfer-verifier')
    }

    console.log('[Auth] Session transfer completed')

    const mainWindow = windowManager.findWindowByType('main')
    if (mainWindow) {
      const sendSessionTransfer = () => {
        if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
        mainWindow.webContents.send(
          'auth:session-transfer',
          safeStorageService.getAuthSessionMetadata()
        )
        console.log('[Auth] Session transfer IPC sent to renderer')
      }

      if (mainWindow.webContents.isLoading()) {
        mainWindow.webContents.once('did-finish-load', sendSessionTransfer)
      } else {
        sendSessionTransfer()
      }

      // Focus the main window
      mainWindow.show()
      mainWindow.focus()
    } else {
      // The encrypted session is already durable. App startup will restore it
      // even if this handoff arrived before a main renderer existed.
      console.warn('[Auth] No main window available; session persisted for app startup')
    }
  } catch (err) {
    console.error('[Auth] Failed to fetch session transfer data:', err)
  }
}

// Legacy handleSessionTransfer removed — accepted unsigned base64 data via deep link.
// Use handleSessionTransferWithToken (server-validated token) instead.

// Handle subscription-updated deep link with retry mechanism
async function handleSubscriptionUpdated(): Promise<void> {
  console.log('[Subscription] Deep link triggered - refreshing entitlements')
  const { subscriptionService } = await import('./services/subscription-service')
  const { BrowserWindow } = await import('electron')

  // Retry logic: Stripe webhook may take a moment to process
  const maxRetries = 3
  const retryDelayMs = 2000

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const previousTier = subscriptionService.getEntitlements()?.tier
      await subscriptionService.refresh()
      const newTier = subscriptionService.getEntitlements()?.tier

      console.log(
        `[Subscription] Refresh attempt ${attempt}: previous=${previousTier}, new=${newTier}`
      )

      // If tier changed from free, we're done
      if (previousTier === 'free' && newTier !== 'free') {
        console.log('[Subscription] Subscription upgrade detected!')
        break
      }

      // If still on free tier and we have retries left, wait and retry
      if (newTier === 'free' && attempt < maxRetries) {
        console.log(`[Subscription] Still free tier, retrying in ${retryDelayMs}ms...`)
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
        continue
      }

      // Final attempt or already paid tier
      break
    } catch (error) {
      console.error(`[Subscription] Refresh attempt ${attempt} failed:`, error)
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      }
    }
  }

  // Notify all windows regardless of outcome
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('subscription:refreshed')
    }
  })
  console.log('[Subscription] Entitlements refresh complete')
}

function createChatParityFixtureWindow(): BrowserWindow {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (!rendererUrl) {
    throw new Error('Electron renderer URL is unavailable for chat parity fixture mode')
  }

  const theme = process.env.CHAT_PARITY_THEME === 'dark' ? 'dark' : 'light'
  const requestedWidth = Number(process.env.CHAT_PARITY_WIDTH)
  const width = requestedWidth === 390 || requestedWidth === 640 ? requestedWidth : 896
  const scenario = process.env.CHAT_PARITY_SCENARIO?.trim() || 'gallery'
  const query = new URLSearchParams({
    window: 'chat-parity-fixture',
    theme,
    width: String(width),
    scenario,
    perf: '1'
  })

  const fixtureWindow = new BrowserWindow({
    width: Math.max(430, width + 40),
    height: 900,
    minWidth: 430,
    minHeight: 500,
    show: false,
    title: 'Overlay chat parity fixture',
    titleBarStyle: 'hiddenInset',
    backgroundColor: theme === 'dark' ? '#09090b' : '#fafafa',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  void fixtureWindow.loadURL(`${rendererUrl}?${query.toString()}`)
  fixtureWindow.once('ready-to-show', () => fixtureWindow.show())
  fixtureWindow.on('closed', () => app.quit())
  return fixtureWindow
}

function createFileParityFixtureWindow(): BrowserWindow {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (!rendererUrl)
    throw new Error('Electron renderer URL is unavailable for file parity fixture mode')

  const theme = process.env.FILE_PARITY_THEME === 'dark' ? 'dark' : 'light'
  const requestedWidth = Number(process.env.FILE_PARITY_WIDTH)
  const width = [1024, 1280, 1440].includes(requestedWidth) ? requestedWidth : 1280
  const scenario = process.env.FILE_PARITY_SCENARIO?.trim() || 'gallery'
  const query = new URLSearchParams({
    window: 'file-parity-fixture',
    theme,
    width: String(width),
    scenario,
    perf: '1'
  })
  const fixtureWindow = new BrowserWindow({
    width: width + 48,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Overlay files parity fixture',
    titleBarStyle: 'hiddenInset',
    backgroundColor: theme === 'dark' ? '#09090b' : '#fafafa',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  void fixtureWindow.loadURL(`${rendererUrl}?${query.toString()}`)
  fixtureWindow.once('ready-to-show', () => fixtureWindow.show())
  fixtureWindow.on('closed', () => app.quit())
  return fixtureWindow
}

app.whenReady().then(async () => {
  if (isFileParityFixtureMode) {
    console.log('[Fixture] Starting isolated desktop files parity harness')
    createFileParityFixtureWindow()
    return
  }
  if (isChatParityFixtureMode) {
    console.log('[Fixture] Starting isolated desktop chat parity harness')
    createChatParityFixtureWindow()
    return
  }

  console.log('[Startup] Electron app ready; initializing windows and services')

  electronApp.setAppUserModelId('com.electron')

  // The app partition needs only audio capture. Browser permissions are handled
  // separately by the interactive browser partition and are never shared here.
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const requestedMedia = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
      const audioOnly =
        requestedMedia.length > 0 && requestedMedia.every((mediaType) => mediaType === 'audio')
      callback(permission === 'media' && audioOnly && isTrustedRendererUrl(webContents.getURL()))
    }
  )
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (!webContents || permission !== 'media') return false
    return isTrustedRendererUrl(webContents.getURL())
  })

  // Security: Verify code signing in production
  if (app.isPackaged) {
    const signResult = await verifyCodeSigning()
    if (!signResult.valid) {
      console.error('[Security] Code signing verification failed:', signResult.error)
      auditLogger.log({
        type: 'security:tampering_detected',
        action: 'Code signing verification failed at startup',
        details: { error: signResult.error },
        success: false
      })
      dialog.showErrorBox(
        'Security Warning',
        'Code signing verification failed. The application may have been tampered with and will now exit.'
      )
      app.quit()
      return
    } else {
      console.log('[Security] Code signing verification passed')
    }
  }

  app.on('browser-window-created', (_event, window) => {
    windowManager.registerWindowZoomCommands(window)
  })

  // Load persisted settings
  settingsService.initializeFromPersistedSettings()
  if (!isParityFixtureMode) initSentry()

  // Check if onboarding is complete to determine overlay visibility
  const onboardingComplete = settingsService.onboardingComplete

  registerBrowserIPC()
  registerAllIPC()

  nativeAudioCaptureService.on('level', (level: number) => {
    windowManager.broadcastToAllWindows('native-audio:level', level)
  })
  void nativeAudioCaptureService.initialize()

  // Authentication is restored from OS-protected storage by the main process.
  // Renderers never supply tokens or decide whether the process is authenticated.
  const storedSession = safeStorageService.getAuthSession()
  if (storedSession) {
    settingsService.isAuthenticated = true
    keyCacheService.setAccessToken(storedSession.accessToken)
    subscriptionService.setUserId(storedSession.user.id)
  } else {
    settingsService.isAuthenticated = false
  }

  // MainWindow owns the normal app lifecycle and is always present when the app
  // launches. Keep it inactive so Overlay does not steal focus from the user's
  // current app. The preference below controls only floating panels.
  const showPanelsOnStartup = !onboardingComplete || settingsService.showPanelsOnStartup
  const mainWindow = windowManager.createMainWindow(true, false)
  windowManager.createOverlayWindow(true)

  // macOS emits `activate` during / right after launch. Keep suppressing it long
  // enough that the launch-time event cannot focus the inactive MainWindow.
  setTimeout(() => {
    appLaunchSettled = true
  }, 1500)

  // Initialize auto-updater (production only)
  if (mainWindow && !process.env.DEV_SERVER_URL) {
    autoUpdaterService.initialize(mainWindow)
  }

  // Preload panel windows for faster activation (always hidden).
  panelManager.preloadAllPanels()

  // After preloads settle, restore or keep panels hidden per the setting.
  setTimeout(() => {
    panelManager.applyStartupPanelVisibility(showPanelsOnStartup && onboardingComplete)
  }, 2200)

  // Initialize subscription service for usage tracking and entitlements
  subscriptionService
    .initialize()
    .then(async () => {
      console.log('[Main] Subscription service initialized')

      // Schedule token refresh if we have a stored session
      const session = safeStorageService.getAuthSession()
      if (session?.refreshToken) {
        await activateAuthenticatedSession(session)
        console.log('[Main] Restored and scheduled existing session')
      }
    })
    .catch((error) => {
      console.error('[Main] Failed to initialize subscription service:', error)
    })

  // Initialize hotkey manager only if onboarding is complete AND accessibility permission is granted
  // Otherwise, defer initialization until onboarding completes
  // IMPORTANT: Check actual accessibility permission, not just onboardingComplete flag
  // Using the exported function from hotkey-manager for consistency
  const shouldInitializeHotkeys = onboardingComplete && hasAccessibilityPermission()

  if (shouldInitializeHotkeys) {
    setupHotkeySystem()
  }

  powerMonitor.on('resume', () => scheduleHotkeyRecovery('system resume'))
  powerMonitor.on('unlock-screen', () => scheduleHotkeyRecovery('screen unlock'))
  powerMonitor.on('user-did-become-active', () => scheduleHotkeyRecovery('user session activation'))
  hotkeyHealthCheckInterval = setInterval(() => {
    if (hotkeyManager.isInitialized()) hotkeyManager.ensureHotkeysRegistered()
  }, 60_000)

  // Initialize local transcription services
  // Priority: Start selected model + base Whisper as fallback
  if (settingsService.localTranscriptionEnabled) {
    const selectedModelId = settingsService.selectedModelId
    const isParakeetSelected = selectedModelId.startsWith('parakeet_')
    const selectedService = getLocalService(selectedModelId)
    const selectedAvailable = selectedService.isAvailable()
    const baseAvailable = whisperKitService.isAvailable()

    console.log('[Main] Selected local model:', selectedModelId)

    // Always start base Whisper as fallback (unless it IS the selected model)
    if (baseAvailable && selectedModelId !== 'openai_whisper-base') {
      whisperKitService.startServerForModel('openai_whisper-base').catch((error) => {
        console.error('[Main] Failed to start base model server:', error)
      })
    }

    if (selectedAvailable) {
      // Start the selected model (Parakeet or Whisper)
      selectedService
        .startServerForModel(selectedModelId as any)
        .then(() => {
          console.log('[Main] Selected model server started successfully')
        })
        .catch((error) => {
          console.error('[Main] Failed to start selected model server:', error)
          if (baseAvailable) {
            console.log('[Main] Will fall back to base model or Groq API for transcription')
          }
        })
    } else if (!isParakeetSelected && baseAvailable) {
      // Only fall back to base if selected was a Whisper model that's unavailable
      console.log('[Main] Selected Whisper model unavailable, using base as fallback')
    } else if (isParakeetSelected) {
      console.log('[Main] Parakeet service unavailable; will use Whisper base fallback')
    } else {
      console.log(
        '[Main] No local ASR backend available; enable Cloud Transcription to use Groq API fallback'
      )
    }
  }

  // Keep a process-lifetime reference. Electron may garbage-collect a locally
  // scoped Tray after startup, which makes the macOS menu-bar icon disappear.
  const trayIcon = nativeImage.createFromPath(
    getResourcePath('logos/logo-big-no-bg-menu-tray-icon.png')
  )
  if (process.platform === 'darwin') {
    trayIcon.setTemplateImage(true)
  }
  tray = new Tray(trayIcon)

  // Function to build tray menu with current modes
  const buildTrayMenu = (): void => {
    const settings = settingsService.loadSettings()
    const modes = settings.smartTranscriptionModes || []
    const activeModeId = settings.activeSmartTranscriptionModeId || 'default'

    // Build modes submenu items with "Off" option
    const modeMenuItems: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Off',
        type: 'radio' as const,
        checked: activeModeId === 'off' || !activeModeId,
        click: () => {
          const currentSettings = settingsService.loadSettings()
          currentSettings.activeSmartTranscriptionModeId = 'off'
          settingsService.saveSettings(currentSettings)
          // Notify renderer windows about the mode change
          windowManager.broadcastToAllWindows('smart-transcription-mode-changed', 'off')
          buildTrayMenu() // Rebuild menu to update checkmarks
        }
      },
      { type: 'separator' as const },
      ...modes.map((mode) => ({
        label: mode.name,
        type: 'radio' as const,
        checked: mode.id === activeModeId,
        click: () => {
          const currentSettings = settingsService.loadSettings()
          currentSettings.activeSmartTranscriptionModeId = mode.id
          settingsService.saveSettings(currentSettings)
          // Notify renderer windows about the mode change
          windowManager.broadcastToAllWindows('smart-transcription-mode-changed', mode.id)
          buildTrayMenu() // Rebuild menu to update checkmarks
        }
      }))
    ]

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Overlay Window',
        click: () => {
          const mainWindow = windowManager.findWindowByType('main')
          if (mainWindow) {
            // Bring window to front and focus it
            mainWindow.show()
            mainWindow.focus()
          } else {
            windowManager.createMainWindow()
          }
        }
      },
      { type: 'separator' },
      ...(modes.length > 0
        ? [
            {
              label: 'Smart Transcription Mode',
              submenu: modeMenuItems
            } as Electron.MenuItemConstructorOptions,
            { type: 'separator' as const }
          ]
        : []),
      { label: 'Quit Overlay', click: () => app.quit() }
    ])

    tray?.setContextMenu(contextMenu)
  }

  buildTrayMenu()
  tray.setToolTip('Overlay')

  // Listen for mode changes to rebuild menu
  ipcMain.on('smart-transcription-modes-updated', () => {
    buildTrayMenu()
  })

  // Onboarding IPC handlers
  ipcMain.handle('permissions:check-microphone', async () => {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('microphone')
    }
    return 'granted'
  })

  ipcMain.handle('permissions:request-microphone', async () => {
    if (process.platform === 'darwin') {
      // Ensure app is in foreground - macOS won't show permission dialog otherwise
      app.focus({ steal: true })

      // Check current status first
      const currentStatus = systemPreferences.getMediaAccessStatus('microphone')
      console.log('[Permissions] Current microphone status:', currentStatus)

      if (currentStatus === 'granted') {
        return 'granted'
      }

      if (currentStatus === 'denied') {
        // Already denied - user must go to System Settings
        console.log('[Permissions] Microphone access was previously denied')
        return 'denied'
      }

      // Request permission (status is 'not-determined' or 'restricted')
      console.log('[Permissions] Requesting microphone access...')
      const granted = await systemPreferences.askForMediaAccess('microphone')
      console.log('[Permissions] Microphone access granted:', granted)
      return granted ? 'granted' : 'denied'
    }
    return 'granted'
  })

  ipcMain.handle('permissions:check-accessibility', async () => {
    if (process.platform === 'darwin') {
      return systemPreferences.isTrustedAccessibilityClient(false)
    }
    return true
  })

  ipcMain.handle('permissions:request-accessibility', async () => {
    if (process.platform === 'darwin') {
      systemPreferences.isTrustedAccessibilityClient(true)
      return 'requested'
    }
    return 'granted'
  })

  ipcMain.handle('permissions:check-system-events', async () => {
    if (process.platform === 'darwin') {
      // Check if we have permission to control System Events
      // We do this by attempting a simple AppleScript that requires the permission
      try {
        execSync(
          'osascript -e \'tell application "System Events" to return name of first process\'',
          { timeout: 2000, stdio: 'pipe' }
        )
        return true
      } catch {
        return false
      }
    }
    return true
  })

  ipcMain.handle('permissions:request-system-events', async () => {
    if (process.platform === 'darwin') {
      // Trigger the System Events permission dialog by running an AppleScript
      // that requires the permission
      try {
        exec('osascript -e \'tell application "System Events" to return name of first process\'')
        return 'requested'
      } catch {
        return 'error'
      }
    }
    return 'granted'
  })

  ipcMain.handle('onboarding:show-overlay', async () => {
    windowManager.ensureOverlayWindowVisible()
  })

  ipcMain.handle('onboarding:hide-overlay', async () => {
    // Retained for preload compatibility. The overlay pill is now persistent,
    // including during onboarding, so a legacy hide request reasserts it.
    windowManager.ensureOverlayWindowVisible()
  })

  ipcMain.handle('onboarding:check-complete', async () => {
    return settingsService.onboardingComplete
  })

  ipcMain.handle('onboarding:init-panel-hotkeys', async () => {
    console.log('[Main] Initializing panel hotkeys for onboarding test')

    if (!hasAccessibilityPermission()) {
      console.log('[Main] Skipping hotkey init - accessibility not granted yet')
      return false
    }

    if (!hotkeyManager.isInitialized()) {
      setupHotkeySystem({ registerPanelHotkeys: true })
    }

    return true
  })

  ipcMain.handle('onboarding:set-complete', async () => {
    settingsService.onboardingComplete = true
    settingsService.persistCurrentSettings()

    if (!hotkeyManager.isInitialized() && hasAccessibilityPermission()) {
      setupHotkeySystem({ registerPanelHotkeys: true })
    }

    const overlayWindow = windowManager.findWindowByType('overlay')
    if (overlayWindow) {
      overlayWindow.show()
    }
    return true
  })

  ipcMain.handle('auth:check-authenticated', async () => {
    return safeStorageService.getAuthSessionMetadata() !== null
  })

  ipcMain.handle('auth:start-sign-in', async (_event, forceSignIn?: boolean) => {
    try {
      await startNativeSignIn(forceSignIn === true)
      return { success: true }
    } catch (error) {
      const code =
        error instanceof Error && /^[a-z0-9_:-]{1,120}$/i.test(error.message)
          ? error.message
          : 'native_auth_start_failed'
      return { success: false, error: code }
    }
  })

  ipcMain.handle('server:get-profile', () => {
    return serverProfileService.getActiveProfile()
  })

  ipcMain.handle('server:verify-profile', async (_event, origin: string) => {
    if (typeof origin !== 'string' || origin.length > 2048) {
      throw new Error('invalid_server_origin')
    }
    const normalized = normalizeServerOrigin(origin)
    const parent = windowManager.findWindowByType('main')
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: 'Verify Overlay Server',
      message: `Allow Overlay to contact ${normalized}?`,
      detail:
        'Only continue if you trust this server. It will receive your sign-in and Overlay data after you connect.',
      buttons: ['Cancel', 'Verify Server'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }
    const result = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
    if (result.response !== 1) throw new Error('server_verification_cancelled')
    return serverProfileService.verifyCandidate(normalized)
  })

  ipcMain.handle(
    'server:activate-profile',
    async (_event, input: { profile: OverlayServerProfile; confirmation: string }) => {
      if (!input?.profile || input.confirmation !== input.profile.origin) {
        throw new Error('server_switch_confirmation_required')
      }
      const verified = await serverProfileService.verifyCandidate(input.profile.origin)
      if (verified.deploymentId !== input.profile.deploymentId) {
        throw new Error('server_deployment_changed_during_confirmation')
      }
      const parent = windowManager.findWindowByType('main')
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: 'Connect to Overlay Server',
        message: `Connect to ${verified.origin}?`,
        detail: `Deployment: ${verified.deploymentId}\n\nYou will be signed out. Credentials from the current server will not be sent to the new server.`,
        buttons: ['Cancel', 'Connect and Sign Out'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      }
      const result = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options)
      if (result.response !== 1) throw new Error('server_switch_cancelled')
      cancelTokenRefresh()
      cancelPendingNativeAuth()
      deactivateAuthenticatedSession()
      safeStorageService.clearAuthSession()
      serverProfileService.activate(verified)
      windowManager.broadcastToAllWindows('server:profile-changed', verified)
      windowManager.broadcastToAllWindows('auth:force-sign-out')
      return verified
    }
  )

  // Explicit sign out handler
  ipcMain.handle('auth:sign-out', async () => {
    cancelTokenRefresh()
    cancelPendingNativeAuth()
    deactivateAuthenticatedSession()
    safeStorageService.clearAuthSession()
    console.log('[Auth] Signed out - session cleared')
    return { success: true }
  })

  // Launch at startup handlers
  ipcMain.handle('settings:get-launch-at-startup', async () => {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  })

  ipcMain.handle('settings:set-launch-at-startup', async (_event, enabled: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    })
    console.log('[Main] Launch at startup set to:', enabled)
    return true
  })

  app.on('activate', () => {
    // app.hide()→showInactive() used to yield focus can emit activate; don't
    // steal focus back by forcing the main window open.
    if (isYieldingFocus()) return

    windowManager.ensureOverlayWindowVisible()

    // During first launch macOS fires `activate`; MainWindow is already visible
    // via showInactive(), so do not focus it. Dock clicks after launch still
    // activate the existing Overlay window below.
    if (!appLaunchSettled) return

    const mainWindow = windowManager.findWindowByType('main')
    if (mainWindow) {
      mainWindow.focus()
      mainWindow.show()
    } else {
      windowManager.createMainWindow(true)
    }
  })
})

app.on('before-quit', () => {
  if (isParityFixtureMode) return
  beginShutdown()
})

app.on('window-all-closed', () => {
  if (isParityFixtureMode || process.platform !== 'darwin') {
    app.quit()
  }
})
