import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))

vi.mock('./security-service', () => ({
  auditLogger: { log: vi.fn() }
}))

vi.mock('./safe-storage-service', () => ({
  safeStorageService: { getAuthSession: vi.fn(() => null) }
}))

import {
  assertIpcValueWithinLimit,
  isChannelAllowedForRole,
  isTrustedRendererUrl,
  maxInputBytesForChannel,
  timeoutForChannel
} from './secure-ipc-main'

describe('secure IPC main boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts only the exact development renderer origin without credentials', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    expect(isTrustedRendererUrl('http://localhost:5173/chat')).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173.evil.example/chat')).toBe(false)
    expect(isTrustedRendererUrl('http://attacker@localhost:5173/chat')).toBe(false)
    expect(isTrustedRendererUrl('file:///etc/passwd')).toBe(false)
    expect(isTrustedRendererUrl('javascript:alert(1)')).toBe(false)
  })

  it('keeps privileged channels scoped to the registered window role', () => {
    expect(isChannelAllowedForRole('terminal:create', 'chat')).toBe(false)
    expect(isChannelAllowedForRole('runtime:execute', 'chat')).toBe(false)
    expect(isChannelAllowedForRole('runtime:execute', 'notebook')).toBe(true)
    expect(isChannelAllowedForRole('models:get-current', 'chat')).toBe(true)
    expect(isChannelAllowedForRole('native-audio:start', 'overlay')).toBe(true)
    expect(isChannelAllowedForRole('native-audio:start', 'transcription')).toBe(false)
    expect(isChannelAllowedForRole('native-audio:start', 'chat')).toBe(false)
    expect(isChannelAllowedForRole('smart-transcription-modes-updated', 'chat')).toBe(true)
    expect(isChannelAllowedForRole('notification:click', 'notification')).toBe(true)
    expect(isChannelAllowedForRole('auth:get-state', 'notification')).toBe(false)
  })

  it('rejects oversized, cyclic, too-deep, too-wide, and unserializable payloads', () => {
    expect(() => assertIpcValueWithinLimit({ ok: 'small' }, 128, 'arguments')).not.toThrow()
    expect(() => assertIpcValueWithinLimit({ body: 'x'.repeat(129) }, 128, 'arguments')).toThrow(
      'ipc_arguments_too_large'
    )

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => assertIpcValueWithinLimit(cyclic, 1024, 'arguments')).toThrow('ipc_value_cycle')

    let deep: Record<string, unknown> = {}
    const root = deep
    for (let index = 0; index < 30; index += 1) {
      deep.next = {}
      deep = deep.next as Record<string, unknown>
    }
    expect(() => assertIpcValueWithinLimit(root, 1024 * 1024, 'arguments')).toThrow(
      'ipc_value_too_deep'
    )

    expect(() =>
      assertIpcValueWithinLimit(
        Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`key-${index}`, true])),
        1024 * 1024,
        'arguments'
      )
    ).toThrow('ipc_object_too_wide')
    expect(() => assertIpcValueWithinLimit({ fn: () => null }, 1024, 'arguments')).toThrow(
      'ipc_value_not_serializable'
    )
  })

  it('allows provider-sized audio only on the real transcription channel', () => {
    const twoMiBAudio = { buf: new ArrayBuffer(2 * 1024 * 1024) }

    expect(maxInputBytesForChannel('stt:transcribe')).toBe(26 * 1024 * 1024)
    expect(() =>
      assertIpcValueWithinLimit(
        twoMiBAudio,
        maxInputBytesForChannel('stt:transcribe'),
        'arguments'
      )
    ).not.toThrow()
    expect(() =>
      assertIpcValueWithinLimit(
        twoMiBAudio,
        maxInputBytesForChannel('stt:unknown'),
        'arguments'
      )
    ).toThrow('ipc_arguments_too_large')
  })

  it('gives long transcription requests enough time to finish', () => {
    expect(timeoutForChannel('stt:transcribe')).toBe(6 * 60_000)
  })
})
