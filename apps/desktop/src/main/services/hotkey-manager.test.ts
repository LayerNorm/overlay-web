import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const globalHandlers = new Map<string, () => void>()
  const hookHandlers = new Map<string, (event: { keycode: number }) => void>()
  const hook = {
    on: vi.fn((event: string, handler: (event: { keycode: number }) => void) => {
      hookHandlers.set(event, handler)
    }),
    start: vi.fn(),
    stop: vi.fn(),
    removeAllListeners: vi.fn()
  }

  return { globalHandlers, hookHandlers, hook }
})

vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn((accelerator: string, handler: () => void) => {
      mocks.globalHandlers.set(accelerator, handler)
      return true
    }),
    unregister: vi.fn((accelerator: string) => {
      mocks.globalHandlers.delete(accelerator)
    }),
    unregisterAll: vi.fn(() => mocks.globalHandlers.clear()),
    isRegistered: vi.fn((accelerator: string) => mocks.globalHandlers.has(accelerator))
  },
  systemPreferences: {
    isTrustedAccessibilityClient: vi.fn(() => true)
  }
}))

vi.mock('./settings-service', () => ({
  settingsService: { isAuthenticated: true }
}))

vi.mock('../utils/panel-latency', () => ({
  panelLatencyMarkHotkey: vi.fn()
}))

vi.mock('uiohook-napi', () => ({
  uIOhook: mocks.hook
}))

import { HotkeyManager } from './hotkey-manager'

describe('HotkeyManager panel lifecycle', () => {
  let manager: HotkeyManager
  const showPanel = vi.fn()
  const hidePanel = vi.fn()
  const onRecordingCancel = vi.fn()

  beforeEach(async () => {
    vi.useFakeTimers()
    mocks.globalHandlers.clear()
    mocks.hookHandlers.clear()
    mocks.hook.start.mockClear()
    mocks.hook.stop.mockClear()
    mocks.hook.removeAllListeners.mockClear()
    mocks.hook.on.mockClear()
    showPanel.mockReset()
    hidePanel.mockReset()
    onRecordingCancel.mockReset()

    manager = new HotkeyManager()
    manager.initialize({
      onRecordingStart: vi.fn(),
      onRecordingStop: vi.fn(),
      onRecordingCancel
    })
    manager.initializePanelTranscribeCallbacks({
      onPanelRecordingStart: vi.fn(),
      onPanelRecordingStop: vi.fn(),
      onPanelQuickToggle: vi.fn(),
      isPanelVisible: () => false,
      showPanel,
      hidePanel
    })
    manager.registerPanelHotkey('chat', 'Cmd ⌘ + .')
    await vi.runAllTimersAsync()
  })

  afterEach(() => {
    manager.unregisterAll()
    vi.useRealTimers()
  })

  it('recovers a panel shortcut when a missed keyup leaves a pending press stuck', () => {
    mocks.hookHandlers.get('keydown')?.({ keycode: 3675 })
    mocks.hookHandlers.get('keydown')?.({ keycode: 52 })
    mocks.globalHandlers.get('Command+.')?.()
    expect(showPanel).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 2_500)
    mocks.globalHandlers.get('Command+.')?.()

    expect(showPanel).toHaveBeenCalledTimes(2)
  })
})
