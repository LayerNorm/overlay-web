import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  powerMonitor,
  Notification,
  desktopCapturer,
  screen,
  session,
  systemPreferences
} from 'electron'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { autoUpdater } from 'electron-updater'
import {
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  capabilities,
  isTrustedFrame,
  methodSchemas,
  type Method,
  type Input,
  type Results,
  type UpdateStatus
} from '../../../packages/overlay-desktop-bridge/src/index'
import {
  getWebShellOrigin,
  startWebShellSignIn,
  getMainWindow,
  remoteWindows,
  remoteWindowSurfaces,
  openExternally,
  WEB_SHELL_PARTITION
} from './web-shell'
import { emitDesktopEvent } from './desktop-events'
import { desktopPanels } from './desktop-panels'
import { embeddedHostService } from './embedded-host-service'
import { parakeetService } from './parakeet-service'
import { whisperKitService } from './whisperkit-service'
import { modelDownloadService } from './model-download-service'
import { cancelPendingNativeAuth } from './security/native-auth-service'
import { safeStorageService } from './security/safe-storage-service'
import { systemUtils } from './system-utils'
import { configureDiagnostics } from './sentry'
import { settingsService } from './settings-service'
import { hotkeyManager, hasAccessibilityPermission } from './hotkey-manager'
import { isAllowedStableUpgrade } from './auto-updater-policy'

const defaults = { dictation: 'Control+Space', chat: 'CommandOrControl+.', notes: 'CommandOrControl+/' }
const keys = { ...defaults }
let holdEnabled = false
let model = 'cloud'
let recording = false
let processing = false
let transcriptionBusy = false
let recordingTarget: 'composer' | 'system' = 'composer'
let update: UpdateStatus = {
  state: app.isPackaged ? 'idle' : 'development',
  message: app.isPackaged ? undefined : 'Updates are available in the installed app.'
}
let hud: BrowserWindow | null = null
let lastSessionCheck = 0
let sessionAuthenticated = false
let activeCalls = 0
let sessionEpoch = 0
const exclusiveCalls = new Set<string>()
// Electron notification interaction handlers need a live object after show resolves.
const deliveredNotifications = new Set<Notification>()
function clearNotifications(): void {
  for (const notification of deliveredNotifications) notification.close()
  deliveredNotifications.clear()
}
let hudReady: Promise<void> = Promise.resolve()
const settingsPath = () => join(app.getPath('userData'), 'web-shell-settings.json')
function persist(): void {
  writeFileSync(settingsPath(), JSON.stringify({ keys, model }), { mode: 0o600 })
}
async function authenticated(): Promise<void> {
  if (Date.now() - lastSessionCheck > 5000) {
    const response = await session
      .fromPartition(WEB_SHELL_PARTITION)
      .fetch(`${getWebShellOrigin()}/api/auth/session`, {
        redirect: 'error',
        signal: AbortSignal.timeout(15_000)
      })
    sessionAuthenticated = response.ok && (await response.json()).authenticated === true
    lastSessionCheck = Date.now()
  }
  if (!sessionAuthenticated) throw new Error('Sign in to Overlay first.')
}
export function clearNativeSession(): void {
  lastSessionCheck = 0
  sessionAuthenticated = false
  hotkeyManager.cancelRecording(false)
  cancelRecording()
  cancelPendingNativeAuth()
  safeStorageService.clearAuthSession()
  embeddedHostService.stopImmediately()
  desktopPanels.closeAll()
  clearNotifications()
  app.setBadgeCount(0)
}
function registerShortcut(id: keyof typeof defaults, accelerator: string): void {
  const previous = keys[id]
  if (id !== 'dictation' && previous === accelerator && globalShortcut.isRegistered(accelerator))
    return
  if (Object.entries(keys).some(([key, value]) => key !== id && value === accelerator))
    throw new Error('Shortcut is already used by another Overlay action.')
  const apply = (value: string): boolean => {
    if (id === 'dictation') {
      hotkeyManager.unregisterHotkey('push-to-talk')
      if (!hotkeyManager.registerHotkey('transcription', value)) return false
      holdEnabled =
        hasAccessibilityPermission() && hotkeyManager.registerHotkey('push-to-talk', value)
      return true
    }
    return hotkeyManager.registerPanelHotkey(id === 'notes' ? 'notebook' : 'chat', value)
  }
  if (!apply(accelerator)) {
    apply(previous)
    throw new Error('Shortcut is unavailable. Choose another combination.')
  }
  keys[id] = accelerator
  persist()
}
function cancelRecording(): void {
  processing = false
  sessionEpoch++
  recording = false
  hud?.webContents.send('recorder:cancel')
  hud?.hide()
  emitDesktopEvent('transcription.cancel', undefined)
}
function startRecording(target: 'system' | 'composer', selectedModel: string): void {
  if (recording || processing || transcriptionBusy) throw new Error('Dictation is already running.')
  recording = true
  sessionEpoch++
  recordingTarget = target
  if (target === 'system') {
    const epoch = sessionEpoch
    void hudReady.then(() => {
      if (recording && sessionEpoch === epoch) {
        hud?.showInactive()
        hud?.webContents.send('recorder:start', selectedModel, epoch)
      }
    })
  } else emitDesktopEvent('transcription.start', { target, model: selectedModel })
}
function stopRecording(): void {
  if (!recording) return
  recording = false
  if (recordingTarget === 'system') {
    processing = true
    hud?.webContents.send('recorder:stop')
  } else emitDesktopEvent('transcription.stop', undefined)
}
async function transcribe(
  input: Input<'transcription.transcribe'>,
  sourceUrl?: string
): Promise<{ text: string }> {
  if (transcriptionBusy) throw new Error('Dictation is still processing.')
  transcriptionBusy = true
  try {
    return await transcribeAudio(input, sourceUrl)
  } finally {
    transcriptionBusy = false
  }
}
async function transcribeAudio(
  input: Input<'transcription.transcribe'>,
  sourceUrl?: string
): Promise<{ text: string }> {
  if (input.model === 'cloud') {
    await authenticated()
    const form = new FormData()
    form.append(
      'audio',
      new Blob([new Uint8Array(input.audio)], { type: input.mime }),
      input.mime === 'audio/mp4'
        ? 'dictation.m4a'
        : input.mime === 'audio/wav'
          ? 'dictation.wav'
          : 'dictation.webm'
    )
    const source = new URL(
      sourceUrl || getMainWindow()?.webContents.getURL() || getWebShellOrigin()
    )
    const referer =
      source.origin === getWebShellOrigin()
        ? `${source.origin}${source.pathname}`
        : getWebShellOrigin()
    const response = await session
      .fromPartition(WEB_SHELL_PARTITION)
      .fetch(`${getWebShellOrigin()}/api/v1/transcribe`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `desktop:${randomUUID()}`, Referer: referer },
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(120_000)
      })
    if (!response.ok) {
      const failure = await response.json().catch(() => null)
      if (failure?.error === 'hosted_transcription_requires_paid_plan')
        throw new Error(
          'Cloud dictation requires a paid plan. Choose a local model in Desktop settings to dictate on this Mac.'
        )
      if (failure?.error === 'transcription_limit_exceeded')
        throw new Error(
          'Your cloud dictation allowance is used up. Choose a local model in Desktop settings.'
        )
      throw new Error(`Cloud dictation failed (${response.status}).`)
    }
    const result = await response.json()
    if (typeof result.text !== 'string') throw new Error('Invalid transcription response.')
    return { text: result.text }
  }
  const directory = mkdtempSync(join(tmpdir(), 'overlay-dictation-'))
  try {
    const file = join(
      directory,
      input.mime === 'audio/mp4'
        ? 'audio.m4a'
        : input.mime === 'audio/wav'
          ? 'audio.wav'
          : 'audio.webm'
    )
    writeFileSync(file, input.audio, { mode: 0o600 })
    return input.model.startsWith('parakeet_')
      ? await parakeetService.transcribe(file, {}, input.model as 'parakeet_v2' | 'parakeet_v3')
      : await whisperKitService.transcribe(file, {}, input.model)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
function updateStatus(value: UpdateStatus): void {
  update = value
  emitDesktopEvent('updates.status', value)
}
export function initializeUpdates(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  autoUpdater.channel = 'latest'
  autoUpdater.on('checking-for-update', () => updateStatus({ state: 'checking' }))
  autoUpdater.on('update-not-available', () => updateStatus({ state: 'current' }))
  autoUpdater.on('update-available', (info) => {
    if (!isAllowedStableUpgrade(app.getVersion(), info.version)) {
      updateStatus({ state: 'error', message: 'Update metadata was rejected.' })
      return
    }
    updateStatus({ state: 'downloading', version: info.version })
    void autoUpdater
      .downloadUpdate()
      .catch(() => updateStatus({ state: 'error', message: 'Update download failed.' }))
  })
  autoUpdater.on('download-progress', (progress) =>
    updateStatus({ state: 'downloading', percent: progress.percent })
  )
  autoUpdater.on('update-downloaded', (info) =>
    updateStatus({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', () =>
    updateStatus({ state: 'error', message: 'Could not check for updates.' })
  )
  const check = () => void autoUpdater.checkForUpdates().catch(() => {})
  setTimeout(check, 3000)
  setInterval(check, 10 * 60 * 1000).unref()
}
const handlers: { [M in Method]: (input: Input<M>) => Promise<Results[M]> | Results[M] } = {
  handshake: () => ({
    bridgeVersion: BRIDGE_VERSION,
    appVersion: app.getVersion(),
    platform: process.platform,
    capabilities: capabilities.filter(
      (capability) => capability !== 'diagnostics' || Boolean(process.env.SENTRY_DSN)
    )
  }),
  'window.openDataFolder': async () => {
    const result = await (await import('electron')).shell.openPath(app.getPath('userData'))
    if (result) throw new Error('Could not open the data folder.')
  },
  'window.openExternal': ({ url }) => openExternally(url),
  'window.setBadgeCount': ({ count }) => {
    app.setBadgeCount(count)
  },
  'auth.signIn': ({ force }) => startWebShellSignIn(force),
  'auth.signedOut': () => clearNativeSession(),
  'hotkeys.list': () => ({ ...keys }),
  'hotkeys.set': ({ id, accelerator }) => registerShortcut(id, accelerator),
  'hotkeys.reset': ({ id }) => registerShortcut(id, defaults[id]),
  'panels.show': async ({ kind }) => {
    await authenticated()
    desktopPanels.show(kind)
  },
  'panels.hide': ({ kind }) => desktopPanels.hide(kind),
  'panels.toggle': async ({ kind }) => {
    await authenticated()
    desktopPanels.toggle(kind)
  },
  'panels.setDocked': ({ kind, edge }) => desktopPanels.setDocked(kind, edge),
  'transcription.status': () => {
    if (!recording && !holdEnabled && hasAccessibilityPermission()) {
      try {
        registerShortcut('dictation', keys.dictation)
      } catch {
        /* Keep toggle dictation available. */
      }
    }
    return {
      recording,
      model,
      microphone: systemPreferences.getMediaAccessStatus('microphone'),
      accessibility:
        process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false)
    }
  },
  'transcription.configure': ({ model: next }) => {
    model = next
    persist()
  },
  'transcription.start': async ({ target, model: selected }) => {
    if (selected === 'cloud') await authenticated()
    startRecording(target, selected)
  },
  'transcription.stop': () => stopRecording(),
  'transcription.transcribe': transcribe,
  'transcription.listModels': async () => {
    const ids = [
      'parakeet_v2',
      'parakeet_v3',
      'openai_whisper-base',
      'openai_whisper-small',
      'openai_whisper-large-v3_turbo'
    ] as const
    return Promise.all(
      ids.map(async (id) => ({
        id,
        name: {
          parakeet_v2: 'Parakeet v2',
          parakeet_v3: 'Parakeet v3',
          'openai_whisper-base': 'Whisper Base',
          'openai_whisper-small': 'Whisper Small',
          'openai_whisper-large-v3_turbo': 'Whisper Large v3 Turbo'
        }[id],
        downloaded: id.startsWith('parakeet_')
          ? modelDownloadService.isParakeetModelInstalled(id as 'parakeet_v2')
          : await modelDownloadService.isModelInstalled(id)
      }))
    )
  },
  'transcription.downloadModel': async ({ id }) => {
    if (id.startsWith('parakeet_'))
      await modelDownloadService.downloadParakeetModel(id as 'parakeet_v2')
    else await modelDownloadService.downloadModel(id)
  },
  'capture.screenshot': async ({ display }) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    })
    const source = sources.find(
      (item) => item.display_id === (display ?? String(screen.getPrimaryDisplay().id))
    )
    if (!source || source.thumbnail.isEmpty())
      throw new Error('Allow screen recording in System Settings to capture a screenshot.')
    return { dataUrl: source.thumbnail.toDataURL(), name: 'Screenshot.png' }
  },
  'notifications.show': ({ title, body, route }) => {
    if (!Notification.isSupported()) throw new Error('Notifications are unavailable on this system.')
    const notification = new Notification({ title, body })
    if (deliveredNotifications.size >= 50) {
      const oldest = deliveredNotifications.values().next().value!
      deliveredNotifications.delete(oldest)
      oldest.close()
    }
    deliveredNotifications.add(notification)
    notification.once('close', () => deliveredNotifications.delete(notification))
    notification.on('click', () => {
      deliveredNotifications.delete(notification)
      const main = getMainWindow()
      if (main?.isMinimized()) main.restore()
      main?.show()
      main?.focus()
      emitDesktopEvent('notifications.click', route)
    })
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        deliveredNotifications.delete(notification)
        notification.close()
        reject(new Error('Could not show the notification. Check notification permissions in System Settings.'))
      }, 5000)
      notification.once('show', () => { clearTimeout(timer); resolve() })
      notification.once('failed', () => { clearTimeout(timer); deliveredNotifications.delete(notification); reject(new Error('Allow Overlay notifications in System Settings to receive alerts.')) })
      notification.show()
    })
  },
  'agentHost.status': () => embeddedHostService.getStatus(),
  'agentHost.start': async ({ adapter, enrollmentCode }) => {
    await authenticated()
    return embeddedHostService.start({ adapterId: adapter, code: enrollmentCode })
  },
  'agentHost.stop': () => embeddedHostService.stop(),
  'agentHost.logs': () => embeddedHostService.getStatus().logTail,
  'diagnostics.status': () => ({ enabled: settingsService.analyticsConsentEnabled }),
  'diagnostics.configure': ({ enabled }) => {
    if (enabled && !process.env.SENTRY_DSN)
      throw new Error('Crash reporting is unavailable in this build.')
    configureDiagnostics(enabled)
  },
  'updates.status': () => update,
  'updates.check': async () => {
    if (app.isPackaged) await autoUpdater.checkForUpdates()
    return update
  },
  'updates.install': () => {
    if (update.state !== 'downloaded') throw new Error('No downloaded update is ready.')
    autoUpdater.quitAndInstall()
  }
}
export function registerDesktopRuntime(): void {
  try {
    if (existsSync(settingsPath())) {
      const saved = JSON.parse(readFileSync(settingsPath(), 'utf8'))
      if (saved.keys)
        for (const id of Object.keys(defaults) as (keyof typeof defaults)[])
          if (typeof saved.keys[id] === 'string') keys[id] = saved.keys[id]
      const result = methodSchemas['transcription.configure'].safeParse({ model: saved.model })
      if (result.success) model = result.data.model
    }
  } catch {
    /* Invalid preferences fall back to defaults. */
  }
  if (!existsSync(settingsPath())) {
    try {
      const legacy = JSON.parse(
        readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8')
      )
      const candidate =
        legacy.localTranscriptionEnabled === false ? 'cloud' : legacy.selectedModelId
      const result = methodSchemas['transcription.configure'].safeParse({ model: candidate })
      if (result.success) model = result.data.model
    } catch {
      /* Fresh install. */
    }
  }
  // No legacy native credentials are retained alongside the window's cookie session.
  safeStorageService.clearAuthSession()
  ipcMain.handle(BRIDGE_CHANNEL, async (event, method: unknown, value: unknown) => {
    if (
      !remoteWindows.has(event.sender) ||
      !isTrustedFrame(
        event.senderFrame?.url ?? '',
        event.senderFrame === event.sender.mainFrame,
        getWebShellOrigin()
      )
    )
      throw new Error('Untrusted desktop caller.')
    if (typeof method !== 'string' || !Object.hasOwn(methodSchemas, method))
      throw new Error('Unknown desktop method.')
    if (activeCalls >= 8) throw new Error('Too many desktop operations.')
    const parsed = methodSchemas[method as Method].safeParse(value)
    if (!parsed.success) throw new Error('Invalid desktop arguments.')
    const exclusive =
      method === 'transcription.transcribe' || method === 'transcription.downloadModel'
    if (exclusive && exclusiveCalls.has(method))
      throw new Error('This desktop operation is already running.')
    if (exclusive) exclusiveCalls.add(method)
    activeCalls++
    try {
      if (method === 'handshake')
        return {
          ...(await handlers.handshake(undefined)),
          surface: remoteWindowSurfaces.get(event.sender) ?? 'main'
        }
      // The method and its argument are checked together before dispatch.
      const handler = handlers[method as Method] as (input: unknown, sourceUrl?: string) => unknown
      return await handler(parsed.data, event.senderFrame?.url)
    } finally {
      activeCalls--
      if (exclusive) exclusiveCalls.delete(method)
    }
  })
  hotkeyManager.initialize(
    {
      onRecordingStart: () => {
        const epoch = sessionEpoch
        void (model === 'cloud' ? authenticated() : Promise.resolve())
          .then(() => {
            if (epoch === sessionEpoch && hotkeyManager.getRecordingState().isRecording)
              startRecording('system', model)
          })
          .catch(() => hotkeyManager.cancelRecording())
      },
      onRecordingStop: () => stopRecording(),
      onRecordingCancel: () => cancelRecording()
    },
    () => true
  )
  hotkeyManager.initializePanelCallbacks({
    onPanelToggle: (panel) => {
      if (panel === 'browser') return
      void authenticated()
        .then(() => desktopPanels.toggle(panel === 'notebook' ? 'notes' : 'chat'))
        .catch(() => {})
    }
  })
  powerMonitor.on('resume', () => hotkeyManager.recoverHotkeys())
  powerMonitor.on('unlock-screen', () => hotkeyManager.recoverHotkeys())
  const health = setInterval(() => {
    hotkeyManager.ensureHotkeysRegistered()
    hotkeyManager.ensureReleaseMonitor()
  }, 60_000)
  health.unref()
  for (const id of Object.keys(defaults) as (keyof typeof defaults)[]) {
    try {
      registerShortcut(id, keys[id])
    } catch {
      /* Settings can repair shortcut conflicts. */
    }
  }
  hud = new BrowserWindow({
    width: 300,
    height: 90,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    show: false,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/web-shell.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  hudReady = hud.loadFile(join(__dirname, '../renderer/recorder.html'))
  hud.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  hud.webContents.on('will-navigate', (event) => event.preventDefault())
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      !!hud &&
        contents === hud.webContents &&
        permission === 'media' &&
        details.isMainFrame === true &&
        contents.getURL().startsWith('file:') &&
        'mediaTypes' in details &&
        details.mediaTypes?.every((type) => type === 'audio') === true
    )
  })
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission) =>
      !!hud &&
      contents === hud.webContents &&
      permission === 'media' &&
      contents.getURL().startsWith('file:')
  )
  ipcMain.handle('recorder:transcribe', async (event, input: unknown, recordingEpoch: unknown) => {
    if (
      !hud ||
      event.sender !== hud.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      !event.senderFrame?.url.startsWith('file:')
    )
      throw new Error('Untrusted recorder.')
    if (!processing || recordingEpoch !== sessionEpoch) throw new Error('Dictation was cancelled.')
    const epoch = sessionEpoch
    try {
      const result = await transcribe(methodSchemas['transcription.transcribe'].parse(input))
      if (epoch !== sessionEpoch) throw new Error('Dictation was cancelled.')
      await systemUtils.pasteText(result.text, false, false)
      emitDesktopEvent('transcription.final', result)
      return result
    } finally {
      if (epoch === sessionEpoch) {
        recording = false
        processing = false
        hud.hide()
      }
    }
  })
  ipcMain.on('recorder:cancel', (event) => {
    if (hud && event.sender === hud.webContents) cancelRecording()
  })
  app.on('before-quit', () => {
    clearNotifications()
    embeddedHostService.stopImmediately()
    hotkeyManager.unregisterAll()
    parakeetService.stopServer()
    whisperKitService.stopServer()
  })
}
