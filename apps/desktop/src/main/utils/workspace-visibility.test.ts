import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { app } from 'electron'
import { setVisibleOnAllWorkspacesKeepDock, restoreDockIcon } from './workspace-visibility'

vi.mock('electron', () => ({
  app: {
    dock: {
      show: vi.fn()
    },
    setActivationPolicy: vi.fn()
  }
}))

type MockBrowserWindow = {
  setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>
  setAlwaysOnTop: ReturnType<typeof vi.fn>
  moveTop: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
}

function createMockWindow(visible = true): MockBrowserWindow {
  return {
    setVisibleOnAllWorkspaces: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    moveTop: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => visible)
  }
}

describe('workspace-visibility helpers', () => {
  const dockShow = app.dock?.show as ReturnType<typeof vi.fn>
  const setActivationPolicy = app.setActivationPolicy as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    dockShow.mockClear()
    setActivationPolicy.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('skips process-type transform by default and does not flip Dock policy', () => {
    const win = createMockWindow()
    setVisibleOnAllWorkspacesKeepDock(win as unknown as Electron.BrowserWindow)

    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')

    vi.advanceTimersByTime(300)
    expect(setActivationPolicy).not.toHaveBeenCalled()
    expect(dockShow).not.toHaveBeenCalled()
    expect(win.moveTop).not.toHaveBeenCalled()
  })

  it('restores the dock icon when process-type transform is explicitly enabled', () => {
    const win = createMockWindow()
    setVisibleOnAllWorkspacesKeepDock(win as unknown as Electron.BrowserWindow, 'floating', {
      skipTransformProcessType: false
    })

    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: false
    })

    vi.advanceTimersByTime(300)
    expect(setActivationPolicy).toHaveBeenCalledWith('regular')
    expect(dockShow).toHaveBeenCalledTimes(1)
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    expect(win.moveTop).toHaveBeenCalledTimes(1)
  })

  it('reasserts the screen-saver level for fullscreen overlays', () => {
    const win = createMockWindow()
    setVisibleOnAllWorkspacesKeepDock(win as unknown as Electron.BrowserWindow, 'screen-saver')

    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
  })

  it('restores the dock icon when called directly', () => {
    restoreDockIcon()

    expect(dockShow).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(setActivationPolicy).toHaveBeenCalledWith('regular')
    expect(dockShow).toHaveBeenCalledTimes(1)
  })

  it('does not raise hidden windows when restoring the dock icon', () => {
    const win = createMockWindow(false)
    restoreDockIcon(win as unknown as Electron.BrowserWindow)

    vi.advanceTimersByTime(300)
    expect(setActivationPolicy).toHaveBeenCalledWith('regular')
    expect(dockShow).toHaveBeenCalledTimes(1)
    expect(win.moveTop).not.toHaveBeenCalled()
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled()
  })
})
