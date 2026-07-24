import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { restorePersistentOverlayWindow } from './persistent-overlay'

function createWindow(visible: boolean, destroyed = false) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    isVisible: vi.fn(() => visible),
    setVisibleOnAllWorkspaces: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    showInactive: vi.fn()
  }
}

describe('restorePersistentOverlayWindow', () => {
  it('restores a hidden pill without focusing Overlay', () => {
    const window = createWindow(false)

    expect(restorePersistentOverlayWindow(window as unknown as BrowserWindow)).toBe(true)
    expect(window.showInactive).toHaveBeenCalledTimes(1)
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
  })

  it('reasserts overlay behavior without reshowing an already visible pill', () => {
    const window = createWindow(true)

    expect(restorePersistentOverlayWindow(window as unknown as BrowserWindow)).toBe(true)
    expect(window.showInactive).not.toHaveBeenCalled()
    expect(window.setAlwaysOnTop).toHaveBeenCalledTimes(1)
  })

  it('does nothing after the overlay window is destroyed', () => {
    const window = createWindow(false, true)

    expect(restorePersistentOverlayWindow(window as unknown as BrowserWindow)).toBe(false)
    expect(window.showInactive).not.toHaveBeenCalled()
    expect(window.setAlwaysOnTop).not.toHaveBeenCalled()
  })
})
