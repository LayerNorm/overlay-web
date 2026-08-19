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
  const globalShortcut = {
    register: vi.fn((accelerator: string, handler: () => void) => {
      globalHandlers.set(accelerator, handler)
      return true
    }),
    unregister: vi.fn((accelerator: string) => {
      globalHandlers.delete(accelerator)
    }),
    unregisterAll: vi.fn(() => globalHandlers.clear()),
    isRegistered: vi.fn((accelerator: string) => globalHandlers.has(accelerator))
  }
  const systemPreferences = {
    isTrustedAccessibilityClient: vi.fn(() => true)
  }
  const settingsService = { isAuthenticated: true }
  const panelLatencyMarkHotkey = vi.fn()

  return {
    globalHandlers,
    hookHandlers,
    hook,
    globalShortcut,
    systemPreferences,
    settingsService,
    panelLatencyMarkHotkey
  }
})

vi.mock('electron', () => ({
  globalShortcut: mocks.globalShortcut,
  systemPreferences: mocks.systemPreferences
}))

vi.mock('./settings-service', () => ({
  settingsService: mocks.settingsService
}))

vi.mock('../utils/panel-latency', () => ({
  panelLatencyMarkHotkey: mocks.panelLatencyMarkHotkey
}))

vi.mock('uiohook-napi', () => ({
  uIOhook: mocks.hook
}))

import { HotkeyManager, type PanelToggleMode } from './hotkey-manager'

const PANELS: PanelToggleMode[] = ['chat', 'notebook', 'browser']
const PANEL_HOTKEYS: Record<PanelToggleMode, string> = {
  chat: 'Cmd ⌘ + .',
  notebook: 'Cmd ⌘ + /',
  browser: 'Cmd ⌘ + \\'
}
const PANEL_ACCELERATORS: Record<PanelToggleMode, string> = {
  chat: 'Command+.',
  notebook: 'Command+/',
  browser: 'Command+\\'
}

describe('HotkeyManager panel lifecycle', () => {
  let manager: HotkeyManager
  const onPanelToggle = vi.fn()
  const onRecordingCancel = vi.fn()

  beforeEach(() => {
    mocks.globalHandlers.clear()
    mocks.hookHandlers.clear()
    mocks.globalShortcut.register.mockClear()
    mocks.globalShortcut.unregister.mockClear()
    mocks.globalShortcut.unregisterAll.mockClear()
    mocks.globalShortcut.isRegistered.mockClear()
    mocks.hook.start.mockClear()
    mocks.hook.stop.mockClear()
    mocks.hook.removeAllListeners.mockClear()
    mocks.hook.on.mockClear()
    mocks.systemPreferences.isTrustedAccessibilityClient.mockClear()
    mocks.systemPreferences.isTrustedAccessibilityClient.mockReturnValue(true)
    mocks.settingsService.isAuthenticated = true
    mocks.panelLatencyMarkHotkey.mockClear()
    onPanelToggle.mockReset()
    onRecordingCancel.mockReset()

    manager = new HotkeyManager()
    manager.initialize({
      onRecordingStart: vi.fn(),
      onRecordingStop: vi.fn(),
      onRecordingCancel
    })
    manager.initializePanelCallbacks({ onPanelToggle })
  })

  afterEach(() => {
    manager.unregisterAll()
  })

  it.each(PANELS)('registers %s through globalShortcut', (panel) => {
    expect(manager.registerPanelHotkey(panel, PANEL_HOTKEYS[panel])).toBe(true)
    expect(mocks.globalShortcut.register).toHaveBeenCalledWith(
      PANEL_ACCELERATORS[panel],
      expect.any(Function)
    )
    expect(mocks.globalHandlers.has(PANEL_ACCELERATORS[panel])).toBe(true)
  })

  it.each(PANELS)('toggles %s through the shared panel callback', (panel) => {
    manager.registerPanelHotkey(panel, PANEL_HOTKEYS[panel])

    mocks.globalHandlers.get(PANEL_ACCELERATORS[panel])?.()

    expect(onPanelToggle).toHaveBeenCalledTimes(1)
    expect(onPanelToggle).toHaveBeenCalledWith(panel)
    expect(mocks.panelLatencyMarkHotkey).toHaveBeenCalledWith(panel)
  })

  it('does not initialize uIOhook for panel shortcuts', async () => {
    for (const panel of PANELS) {
      manager.registerPanelHotkey(panel, PANEL_HOTKEYS[panel])
    }
    manager.ensureReleaseMonitor()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.hook.start).not.toHaveBeenCalled()
    expect(mocks.hook.on).not.toHaveBeenCalled()
  })

  it('does not require Accessibility permission for panel shortcuts', () => {
    mocks.systemPreferences.isTrustedAccessibilityClient.mockReturnValue(false)

    for (const panel of PANELS) {
      expect(manager.registerPanelHotkey(panel, PANEL_HOTKEYS[panel])).toBe(true)
    }

    expect(mocks.systemPreferences.isTrustedAccessibilityClient).not.toHaveBeenCalled()
  })

  it.each(PANELS)('unregisters and re-registers %s identically', (panel) => {
    manager.registerPanelHotkey(panel, PANEL_HOTKEYS[panel])
    manager.unregisterPanelHotkey(panel)

    expect(mocks.globalHandlers.has(PANEL_ACCELERATORS[panel])).toBe(false)

    manager.registerPanelHotkey(panel, PANEL_HOTKEYS[panel])
    mocks.globalHandlers.get(PANEL_ACCELERATORS[panel])?.()

    expect(onPanelToggle).toHaveBeenCalledTimes(1)
    expect(onPanelToggle).toHaveBeenCalledWith(panel)
  })

  it('recovers all configured panel shortcuts through the same path', () => {
    for (const panel of PANELS) {
      manager.registerPanelHotkey(panel, PANEL_HOTKEYS[panel])
    }
    onPanelToggle.mockReset()

    expect(manager.recoverHotkeys()).toBe(true)

    for (const panel of PANELS) {
      expect(mocks.globalHandlers.has(PANEL_ACCELERATORS[panel])).toBe(true)
      mocks.globalHandlers.get(PANEL_ACCELERATORS[panel])?.()
    }

    expect(onPanelToggle).toHaveBeenCalledTimes(PANELS.length)
    expect(onPanelToggle.mock.calls.map(([panel]) => panel)).toEqual(PANELS)
    expect(mocks.hook.start).not.toHaveBeenCalled()
  })

  it.each(PANELS)('blocks %s when the user is not authenticated', (panel) => {
    mocks.settingsService.isAuthenticated = false
    manager.registerPanelHotkey(panel, PANEL_HOTKEYS[panel])

    mocks.globalHandlers.get(PANEL_ACCELERATORS[panel])?.()

    expect(onPanelToggle).not.toHaveBeenCalled()
    expect(mocks.panelLatencyMarkHotkey).not.toHaveBeenCalled()
  })
})
