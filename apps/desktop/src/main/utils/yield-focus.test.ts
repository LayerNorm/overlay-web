import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, BrowserWindow } from 'electron'
import { yieldFocusAfterLastPanelHidden, yieldFocusToPreviousApp } from './yield-focus'

vi.mock('electron', () => ({
  app: {
    hide: vi.fn(),
    show: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))

type MockWindow = {
  hide: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  showInactive: ReturnType<typeof vi.fn>
}

function createWindow(visible = true): MockWindow {
  return {
    hide: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => visible),
    showInactive: vi.fn()
  }
}

describe('yieldFocusToPreviousApp', () => {
  const originalPlatform = process.platform
  const hideApp = app.hide as ReturnType<typeof vi.fn>
  const showApp = app.show as ReturnType<typeof vi.fn>

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
  })

  beforeEach(() => {
    vi.useFakeTimers()
    hideApp.mockClear()
    showApp.mockClear()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  })

  afterEach(() => {
    vi.runAllTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  afterAll(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
  })

  it('restores the Overlay pill after yielding when it is the only visible Overlay window', () => {
    const overlay = createWindow()

    yieldFocusToPreviousApp([overlay as unknown as BrowserWindow])

    expect(hideApp).toHaveBeenCalledTimes(1)
    expect(overlay.showInactive).not.toHaveBeenCalled()

    vi.runAllTimers()

    expect(showApp).toHaveBeenCalledTimes(1)
    expect(overlay.showInactive).toHaveBeenCalledTimes(1)
  })

  it('restores both the pill and an already-open MainWindow after the last panel closes', () => {
    const overlay = createWindow()
    const mainWindow = createWindow()

    yieldFocusToPreviousApp([
      overlay as unknown as BrowserWindow,
      mainWindow as unknown as BrowserWindow
    ])
    vi.runAllTimers()

    expect(showApp).toHaveBeenCalledTimes(1)
    expect(overlay.showInactive).toHaveBeenCalledTimes(1)
    expect(mainWindow.showInactive).toHaveBeenCalledTimes(1)
  })

  it('does not reopen windows that were hidden before focus was yielded', () => {
    const overlay = createWindow()
    const hiddenMainWindow = createWindow(false)

    yieldFocusToPreviousApp([
      overlay as unknown as BrowserWindow,
      hiddenMainWindow as unknown as BrowserWindow
    ])
    vi.runAllTimers()

    expect(overlay.showInactive).toHaveBeenCalledTimes(1)
    expect(hiddenMainWindow.showInactive).not.toHaveBeenCalled()
  })

  it('keeps panel windows hidden when the application is shown again', () => {
    const overlay = createWindow()
    const panel = createWindow(false)
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      overlay as unknown as BrowserWindow,
      panel as unknown as BrowserWindow
    ])
    showApp.mockImplementation(() => {
      panel.isVisible.mockReturnValue(true)
    })

    yieldFocusToPreviousApp([overlay as unknown as BrowserWindow])
    vi.runAllTimers()

    expect(panel.showInactive).not.toHaveBeenCalled()
    expect(panel.hide).toHaveBeenCalledTimes(1)
  })

  it('skips a persistent window if it is destroyed while the app hide settles', () => {
    const overlay = createWindow()

    yieldFocusToPreviousApp([overlay as unknown as BrowserWindow])
    overlay.isDestroyed.mockReturnValue(true)
    vi.runAllTimers()

    expect(overlay.showInactive).not.toHaveBeenCalled()
  })
})

describe('yieldFocusAfterLastPanelHidden', () => {
  const originalPlatform = process.platform
  const hideApp = app.hide as ReturnType<typeof vi.fn>
  const showApp = app.show as ReturnType<typeof vi.fn>

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
  })

  beforeEach(() => {
    vi.useFakeTimers()
    hideApp.mockClear()
    showApp.mockClear()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  })

  afterEach(() => {
    vi.runAllTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  afterAll(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
  })

  it('leaves application visibility untouched while MainWindow is open', () => {
    const overlay = createWindow()
    const mainWindow = createWindow()

    yieldFocusAfterLastPanelHidden(
      mainWindow as unknown as BrowserWindow,
      [overlay as unknown as BrowserWindow, mainWindow as unknown as BrowserWindow]
    )
    vi.runAllTimers()

    expect(hideApp).not.toHaveBeenCalled()
    expect(showApp).not.toHaveBeenCalled()
    expect(mainWindow.showInactive).not.toHaveBeenCalled()
  })

  it('still yields focus without reopening a MainWindow that was already hidden', () => {
    const overlay = createWindow()
    const mainWindow = createWindow(false)

    yieldFocusAfterLastPanelHidden(
      mainWindow as unknown as BrowserWindow,
      [overlay as unknown as BrowserWindow, mainWindow as unknown as BrowserWindow]
    )
    vi.runAllTimers()

    expect(hideApp).toHaveBeenCalledTimes(1)
    expect(showApp).toHaveBeenCalledTimes(1)
    expect(overlay.showInactive).toHaveBeenCalledTimes(1)
    expect(mainWindow.showInactive).not.toHaveBeenCalled()
  })
})
