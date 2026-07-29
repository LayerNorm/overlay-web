import {
  app,
  BrowserWindow,
  ipcMain as electronIpcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { auditLogger } from './security-service'
import { safeStorageService } from './safe-storage-service'
import { areUnsafeLocalCapabilitiesEnabled } from './containment-capability-profile'

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any
type EventHandler = (event: IpcMainEvent, ...args: any[]) => void

export type TrustedIpcWindowRole =
  | 'main'
  | 'overlay'
  | 'chat'
  | 'notebook'
  | 'browser'
  | 'transcription'
  | 'notification'
  | 'fixture'

type TrustedWindowRecord = {
  browserWindowId: number
  role: TrustedIpcWindowRole
}

const trustedWindows = new Map<number, TrustedWindowRecord>()
const registeredChannels = new Set<string>()
const activeCalls = new Map<string, number>()

const DEFAULT_MAX_INPUT_BYTES = 1024 * 1024
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_CONCURRENCY = 8

const AUTH_REQUIRED_PREFIXES = [
  'agent:',
  'app-api:',
  'browser-chat:',
  'chat-media:',
  'composio:',
  'document:',
  'import:',
  'knowledge',
  'memory:',
  'notebook-agent:',
  'runtime:',
  'subscription:',
  'terminal:',
  'workspace:'
] as const

const UNSAFE_CAPABILITY_PREFIXES = ['composio:', 'runtime:', 'terminal:'] as const

const ROLE_CHANNEL_PREFIXES: Record<TrustedIpcWindowRole, readonly string[]> = {
  main: [''],
  overlay: [
    'app-api:',
    'auth:',
    'capture-',
    'chat:',
    'models:',
    'native-audio:',
    'onboarding:',
    'panel:',
    'permissions:',
    'platform:',
    'security:',
    'settings:',
    'storage:',
    'stt:',
    'subscription:',
    'transcription:',
    'window:'
  ],
  chat: [
    'app-api:',
    'auth:',
    'browser-chat:',
    'chat',
    'composio:',
    'context:',
    'document:',
    'knowledge',
    'memory:',
    'models:',
    'panel:',
    'platform:',
    'security:',
    'settings:',
    'smart-',
    'subscription:',
    'window:'
  ],
  notebook: [
    'app-api:',
    'auth:',
    'document:',
    'knowledge',
    'memory:',
    'models:',
    'notebook',
    'panel:',
    'platform:',
    'runtime:',
    'security:',
    'settings:',
    'smart-',
    'subscription:',
    'window:',
    'workspace:'
  ],
  browser: [
    'app-api:',
    'auth:',
    'browser',
    'chat',
    'context:',
    'models:',
    'panel:',
    'platform:',
    'security:',
    'settings:',
    'smart-',
    'subscription:',
    'window:'
  ],
  transcription: [
    'app-api:',
    'auth:',
    'capture-',
    'panel:',
    'platform:',
    'security:',
    'settings:',
    'stt:',
    'subscription:',
    'transcription:',
    'window:'
  ],
  notification: ['notification:', 'panel:', 'platform:', 'window:'],
  fixture: ['app-api:', 'chat', 'knowledge', 'panel:', 'platform:', 'settings:', 'window:']
}

export function registerTrustedIpcWindow(window: BrowserWindow, role: TrustedIpcWindowRole): void {
  hardenTrustedRendererWindow(window)
  trustedWindows.set(window.webContents.id, {
    browserWindowId: window.id,
    role
  })
  window.webContents.once('destroyed', () => {
    trustedWindows.delete(window.webContents.id)
  })
}

function hardenTrustedRendererWindow(window: BrowserWindow): void {
  const { webContents } = window
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

export function unregisterTrustedIpcWebContents(webContents: WebContents): void {
  trustedWindows.delete(webContents.id)
}

export function getTrustedIpcWindowRole(webContents: WebContents): TrustedIpcWindowRole | null {
  return trustedWindows.get(webContents.id)?.role ?? null
}

export const ipcMain = {
  handle(channel: string, handler: InvokeHandler): void {
    assertNewChannel(channel)
    electronIpcMain.handle(channel, async (event, ...args) => {
      const startedAt = Date.now()
      let record: TrustedWindowRecord | null = null
      const callKey = `${event.sender.id}:${channel}`
      try {
        record = validateIpcInvocation(event, channel, args)
        acquireCallSlot(callKey, channel)
        const result = await withTimeout(
          Promise.resolve(handler(event, ...args)),
          timeoutForChannel(channel),
          channel
        )
        assertIpcValueWithinLimit(result, maxOutputBytesForChannel(channel), 'result')
        auditSensitiveCall(channel, record.role, true, Date.now() - startedAt)
        return result
      } catch (error) {
        auditSensitiveCall(channel, record?.role ?? 'untrusted', false, Date.now() - startedAt)
        throw error
      } finally {
        releaseCallSlot(callKey)
      }
    })
  },

  on(channel: string, handler: EventHandler): void {
    assertNewChannel(channel)
    electronIpcMain.on(channel, (event, ...args) => {
      const startedAt = Date.now()
      let record: TrustedWindowRecord | null = null
      try {
        record = validateIpcEvent(event, channel, args)
        handler(event, ...args)
        auditSensitiveCall(channel, record.role, true, Date.now() - startedAt)
      } catch (error) {
        auditSensitiveCall(channel, record?.role ?? 'untrusted', false, Date.now() - startedAt)
        console.warn(`[SecureIPC] Rejected event on ${channel}:`, safeErrorCode(error))
      }
    })
  }
}

function validateIpcInvocation(
  event: IpcMainInvokeEvent,
  channel: string,
  args: unknown[]
): TrustedWindowRecord {
  if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) {
    throw new Error('ipc_subframe_rejected')
  }
  return validateIpcSender(
    event.sender,
    event.senderFrame?.url || event.sender.getURL(),
    channel,
    args
  )
}

function validateIpcEvent(
  event: IpcMainEvent,
  channel: string,
  args: unknown[]
): TrustedWindowRecord {
  if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) {
    throw new Error('ipc_subframe_rejected')
  }
  return validateIpcSender(
    event.sender,
    event.senderFrame?.url || event.sender.getURL(),
    channel,
    args
  )
}

function validateIpcSender(
  sender: WebContents,
  senderUrl: string,
  channel: string,
  args: unknown[]
): TrustedWindowRecord {
  const record = trustedWindows.get(sender.id)
  const senderWindow = BrowserWindow.fromWebContents(sender)
  if (!record || !senderWindow || senderWindow.id !== record.browserWindowId) {
    throw new Error('ipc_unregistered_window')
  }
  if (!isTrustedRendererUrl(senderUrl)) throw new Error('ipc_untrusted_origin')
  if (!isChannelAllowedForRole(channel, record.role)) throw new Error('ipc_role_forbidden')

  const preferences = (
    sender as unknown as {
      getLastWebPreferences?: () => {
        contextIsolation?: boolean
        nodeIntegration?: boolean
        sandbox?: boolean
      }
    }
  ).getLastWebPreferences?.()
  if (
    !preferences ||
    preferences.nodeIntegration === true ||
    preferences.contextIsolation !== true ||
    preferences.sandbox !== true
  ) {
    throw new Error('ipc_insecure_web_preferences')
  }

  assertIpcValueWithinLimit(args, maxInputBytesForChannel(channel), 'arguments')

  if (
    AUTH_REQUIRED_PREFIXES.some((prefix) => channel.startsWith(prefix)) &&
    !safeStorageService.getAuthSession()
  ) {
    throw new Error('ipc_authentication_required')
  }
  if (
    UNSAFE_CAPABILITY_PREFIXES.some((prefix) => channel.startsWith(prefix)) &&
    !areUnsafeLocalCapabilitiesEnabled(app.isPackaged)
  ) {
    throw new Error('ipc_capability_disabled')
  }
  return record
}

export function isTrustedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    if (!app.isPackaged) {
      const configured = process.env.ELECTRON_RENDERER_URL?.trim() || 'http://localhost:5173'
      const allowed = new URL(configured)
      return url.origin === allowed.origin
    }
    if (url.protocol !== 'file:') return false
    const expected = resolve(__dirname, '../renderer/index.html')
    return resolve(fileURLToPath(url)) === expected
  } catch {
    return false
  }
}

export function assertIpcValueWithinLimit(value: unknown, maxBytes: number, label: string): void {
  const bytes = estimateIpcValueBytes(value, new Set(), 0)
  if (bytes > maxBytes) throw new Error(`ipc_${label}_too_large`)
}

function estimateIpcValueBytes(value: unknown, seen: Set<object>, depth: number): number {
  if (depth > 24) throw new Error('ipc_value_too_deep')
  if (value === null || value === undefined) return 0
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8')
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return 8
  if (typeof value === 'function' || typeof value === 'symbol')
    throw new Error('ipc_value_not_serializable')
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (value instanceof Date) return 16
  if (typeof value !== 'object') return 0
  if (seen.has(value)) throw new Error('ipc_value_cycle')
  seen.add(value)
  let total = 0
  if (Array.isArray(value)) {
    for (const entry of value) total += estimateIpcValueBytes(entry, seen, depth + 1)
  } else {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length > 10_000) throw new Error('ipc_object_too_wide')
    for (const [key, entry] of entries) {
      total += Buffer.byteLength(key, 'utf8')
      total += estimateIpcValueBytes(entry, seen, depth + 1)
    }
  }
  seen.delete(value)
  return total
}

export function isChannelAllowedForRole(channel: string, role: TrustedIpcWindowRole): boolean {
  return ROLE_CHANNEL_PREFIXES[role].some((prefix) => channel.startsWith(prefix))
}

function assertNewChannel(channel: string): void {
  if (!/^[a-z0-9][a-z0-9/:-]{1,127}$/i.test(channel)) throw new Error('invalid_ipc_channel')
  if (registeredChannels.has(channel)) throw new Error(`duplicate_ipc_channel:${channel}`)
  registeredChannels.add(channel)
}

function acquireCallSlot(callKey: string, channel: string): void {
  const next = (activeCalls.get(callKey) ?? 0) + 1
  if (next > maxConcurrencyForChannel(channel)) throw new Error('ipc_concurrency_limit')
  activeCalls.set(callKey, next)
}

function releaseCallSlot(callKey: string): void {
  const current = activeCalls.get(callKey)
  if (!current || current <= 1) activeCalls.delete(callKey)
  else activeCalls.set(callKey, current - 1)
}

export function maxInputBytesForChannel(channel: string): number {
  if (channel === 'storage:upload') return 52 * 1024 * 1024
  if (channel === 'app-api:stream' || channel === 'app-api:request') return 16 * 1024 * 1024
  // The transcription API accepts audio files up to 25 MiB. Leave bounded
  // headroom for IPC metadata without weakening the default 1 MiB policy for
  // any other channel.
  if (channel === 'stt:transcribe') return 26 * 1024 * 1024
  if (channel === 'capture-screenshots') return 64 * 1024 * 1024
  return DEFAULT_MAX_INPUT_BYTES
}

function maxOutputBytesForChannel(channel: string): number {
  if (channel === 'app-api:request') return 32 * 1024 * 1024
  if (channel === 'native-audio:stop') return 26 * 1024 * 1024
  return DEFAULT_MAX_OUTPUT_BYTES
}

export function timeoutForChannel(channel: string): number {
  if (channel === 'stt:transcribe') return 6 * 60_000
  if (
    channel === 'app-api:stream' ||
    channel.startsWith('agent:') ||
    channel.startsWith('notebook-agent:')
  ) {
    return 15 * 60_000
  }
  if (channel.startsWith('models:download') || channel.startsWith('runtime:')) return 20 * 60_000
  return DEFAULT_TIMEOUT_MS
}

function maxConcurrencyForChannel(channel: string): number {
  if (channel === 'app-api:stream') return 4
  if (channel.startsWith('terminal:') || channel.startsWith('runtime:')) return 2
  return DEFAULT_MAX_CONCURRENCY
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, channel: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`ipc_timeout:${channel}`)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function auditSensitiveCall(
  channel: string,
  role: TrustedIpcWindowRole | 'untrusted',
  success: boolean,
  durationMs: number
): void {
  if (success && !AUTH_REQUIRED_PREFIXES.some((prefix) => channel.startsWith(prefix))) {
    return
  }
  auditLogger.log({
    type: 'ipc:sensitive_call',
    action: success ? 'Privileged IPC call allowed' : 'Privileged IPC call rejected',
    details: {
      channel,
      role,
      durationBucketMs: durationMs < 100 ? 100 : durationMs < 1000 ? 1000 : 10_000
    },
    success
  })
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : 'unknown_error'
}
