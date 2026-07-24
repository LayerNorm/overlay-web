import { BrowserWindow, screen, app, systemPreferences } from 'electron'
import { join } from 'path'
import { getResourcePath } from '../utils/resources'
import { setVisibleOnAllWorkspacesKeepDock } from '../utils/workspace-visibility'
import { is } from '@electron-toolkit/utils'
import { WindowType } from '../types'
import { restorePersistentOverlayWindow } from '../utils/persistent-overlay'
import { registerTrustedIpcWindow } from './security/secure-ipc-main'

class WindowManager {
  private overlayWindow: BrowserWindow | null = null
  private overlayDisplayPollInterval: ReturnType<typeof setInterval> | null = null
  private overlaySpaceChangeSubscriptionId: number | null = null
  private lastOverlaySpaceReassertAt = 0
  private isShuttingDown = false

  constructor() {
    app.once('before-quit', () => {
      this.isShuttingDown = true
    })
  }

  createOverlayWindow(showImmediately = true): BrowserWindow {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      if (showImmediately) restorePersistentOverlayWindow(this.overlayWindow)
      return this.overlayWindow
    }

    // Fullscreen transparent click-through panel — same model as chat/notebook/browser.
    // The overlay widget is positioned absolutely inside the renderer; only the widget
    // area registers mouse events. The surrounding space is fully click-through.
    const display = screen.getPrimaryDisplay()
    const bounds = display.bounds

    const overlayWindow = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      // NSPanel-style window: floats over other apps' fullscreen Spaces and joins
      // all Spaces without transforming the process to a UIElement (accessory)
      // app, so the Dock icon and Cmd+Tab entry are unaffected. A regular
      // NSWindow only floats over fullscreen Spaces while the app is accessory,
      // which restoreDockIcon deliberately reverts.
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      frame: false,
      transparent: true,
      resizable: false,
      focusable: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      enableLargerThanScreen: true,
      title: 'Overlay',
      icon: getResourcePath('icon.png'),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        devTools: is.dev,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true
      }
    })
    registerTrustedIpcWindow(overlayWindow, 'overlay')
    this.overlayWindow = overlayWindow

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      overlayWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?window=overlay')
    } else {
      overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { window: 'overlay' }
      })
    }

    overlayWindow.setAlwaysOnTop(true, 'screen-saver')

    overlayWindow.once('ready-to-show', () => {
      // Force exact fullscreen bounds and enable click-through with forward.
      // As a panel window this floats over fullscreen Spaces natively, so skip
      // the UIElement process transform (which would hide the Dock icon).
      const displayBounds = screen.getDisplayMatching(overlayWindow.getBounds()).bounds
      overlayWindow.setBounds(displayBounds)
      if (showImmediately) {
        restorePersistentOverlayWindow(overlayWindow)
      }
    })

    // No feature is allowed to permanently hide the pill. app.hide(), Space
    // changes, and legacy onboarding calls can all emit hide; recover on the
    // next turn without activating or focusing the app.
    overlayWindow.on('hide', () => {
      setImmediate(() => {
        if (!this.isShuttingDown && this.overlayWindow === overlayWindow) {
          restorePersistentOverlayWindow(overlayWindow)
        }
      })
    })

    // Multi-monitor: poll cursor and move overlay to the active display
    this.startOverlayDisplayPolling(overlayWindow)

    // Safety net: re-assert Space membership and z-order whenever the active
    // Space changes (e.g. entering a fullscreen app).
    this.subscribeOverlaySpaceChanges(overlayWindow)

    overlayWindow.on('closed', () => {
      if (this.overlayWindow === overlayWindow) this.overlayWindow = null
      this.stopOverlayDisplayPolling()
      this.unsubscribeOverlaySpaceChanges()
    })

    if (process.platform === 'darwin') {
      app.setActivationPolicy('regular')
      void app.dock?.show()
    }

    return overlayWindow
  }

  ensureOverlayWindowVisible(): BrowserWindow {
    const overlayWindow = this.overlayWindow
    if (!overlayWindow || overlayWindow.isDestroyed()) return this.createOverlayWindow(true)
    restorePersistentOverlayWindow(overlayWindow)
    return overlayWindow
  }

  // Poll cursor position and move the fullscreen overlay panel to whichever display
  // the cursor is on. The renderer handles widget positioning within the window.
  private startOverlayDisplayPolling(overlayWindow: BrowserWindow): void {
    this.stopOverlayDisplayPolling()
    let lastDisplayId = screen.getDisplayMatching(overlayWindow.getBounds()).id

    this.overlayDisplayPollInterval = setInterval(() => {
      if (overlayWindow.isDestroyed()) {
        this.stopOverlayDisplayPolling()
        return
      }
      const cursor = screen.getCursorScreenPoint()
      const cursorDisplay = screen.getDisplayNearestPoint(cursor)
      if (cursorDisplay.id === lastDisplayId) return

      // Cursor moved to a different display — resize overlay to cover the new display
      overlayWindow.setBounds(cursorDisplay.bounds)

      lastDisplayId = cursorDisplay.id
    }, 500)
  }

  private stopOverlayDisplayPolling(): void {
    if (this.overlayDisplayPollInterval) {
      clearInterval(this.overlayDisplayPollInterval)
      this.overlayDisplayPollInterval = null
    }
  }

  private subscribeOverlaySpaceChanges(overlayWindow: BrowserWindow): void {
    if (process.platform !== 'darwin') return
    this.unsubscribeOverlaySpaceChanges()
    this.overlaySpaceChangeSubscriptionId = systemPreferences.subscribeWorkspaceNotification(
      'NSWorkspaceActiveSpaceDidChangeNotification',
      () => {
        if (overlayWindow.isDestroyed()) return
        const now = Date.now()
        if (now - this.lastOverlaySpaceReassertAt < 500) return
        this.lastOverlaySpaceReassertAt = now
        restorePersistentOverlayWindow(overlayWindow)
        overlayWindow.moveTop()
      }
    )
  }

  private unsubscribeOverlaySpaceChanges(): void {
    if (this.overlaySpaceChangeSubscriptionId === null) return
    systemPreferences.unsubscribeWorkspaceNotification(this.overlaySpaceChangeSubscriptionId)
    this.overlaySpaceChangeSubscriptionId = null
  }

  createMainWindow(showImmediately = true, focusOnShow = true): BrowserWindow {
    const mainWindow = new BrowserWindow({
      width: 1000,
      height: 750,
      minWidth: 900,
      minHeight: 750,
      maxWidth: 1400,
      maxHeight: 950,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 20, y: 20 },
      transparent: false,
      vibrancy: 'under-window',
      resizable: true,
      focusable: true,
      alwaysOnTop: false,
      hasShadow: true,
      show: false,
      title: '',
      icon: getResourcePath('icon.png'),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        devTools: is.dev,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true
      }
    })
    registerTrustedIpcWindow(mainWindow, 'main')

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?window=main')
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { window: 'main' }
      })
    }

    mainWindow.center()

    // Ensure the app shows in the macOS Dock and app switcher (Cmd+Tab).
    // Without this, the app can appear as a menu-bar-only (accessory) app.
    if (process.platform === 'darwin') {
      app.setActivationPolicy('regular')
      void app.dock?.show()
    }

    if (showImmediately) {
      mainWindow.once('ready-to-show', () => {
        if (focusOnShow) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          mainWindow.showInactive()
        }
      })
    }

    mainWindow.on('blur', () => {
      mainWindow.setWindowButtonVisibility(true)
    })

    this.registerWindowZoomCommands(mainWindow)

    return mainWindow
  }

  registerWindowZoomCommands(win: BrowserWindow): void {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (!input.meta && !input.control) return

      const key = input.key
      const isZoomIn =
        key === '+' || key === '=' || input.code === 'NumpadAdd' || input.code === 'Equal'
      const isZoomOut =
        key === '-' || key === '_' || input.code === 'NumpadSubtract' || input.code === 'Minus'
      const isZoomReset = key === '0' || input.code === 'Digit0' || input.code === 'Numpad0'

      if (!isZoomIn && !isZoomOut && !isZoomReset) return
      event.preventDefault()

      const action = isZoomReset ? 'reset' : isZoomIn ? 'in' : 'out'
      win.webContents.send('window:zoom-command', { action })
    })

    win.webContents.on('did-finish-load', () => {
      win.webContents.setZoomLevel(0)
      win.webContents.setZoomFactor(1)
    })

    win.webContents.on('zoom-changed', () => {
      if (win.webContents.getZoomFactor() !== 1) {
        win.webContents.setZoomFactor(1)
      }
    })
  }

  findWindowByType(type: WindowType): BrowserWindow | undefined {
    if (type === 'overlay' && this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      return this.overlayWindow
    }
    return BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes(`window=${type}`)
    )
  }

  broadcastToAllWindows(channel: string, ...args: unknown[]): void {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send(channel, ...args)
    })
  }

  private notificationWindow: BrowserWindow | null = null

  createNotificationWindow(): BrowserWindow {
    // If window already exists and is not destroyed, return it
    if (this.notificationWindow && !this.notificationWindow.isDestroyed()) {
      return this.notificationWindow
    }

    const display = screen.getPrimaryDisplay()
    const wa = display.workArea
    const NOTIF_W = 400
    const NOTIF_H = 500
    const MARGIN = 16

    this.notificationWindow = new BrowserWindow({
      width: NOTIF_W,
      height: NOTIF_H,
      x: wa.x + wa.width - NOTIF_W - MARGIN,
      y: wa.y + MARGIN,
      frame: false,
      transparent: true,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      title: 'Notification',
      icon: getResourcePath('icon.png'),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        devTools: is.dev,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true
      }
    })
    registerTrustedIpcWindow(this.notificationWindow, 'notification')

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.notificationWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?window=notification')
    } else {
      this.notificationWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { window: 'notification' }
      })
    }

    this.notificationWindow.setAlwaysOnTop(true, 'screen-saver')
    this.notificationWindow.setIgnoreMouseEvents(false)

    this.notificationWindow.once('ready-to-show', () => {
      if (!this.notificationWindow) return
      setVisibleOnAllWorkspacesKeepDock(this.notificationWindow)
      this.notificationWindow.showInactive()
    })

    this.notificationWindow.on('closed', () => {
      this.notificationWindow = null
    })

    return this.notificationWindow
  }

  getNotificationWindow(): BrowserWindow | null {
    if (this.notificationWindow && !this.notificationWindow.isDestroyed()) {
      return this.notificationWindow
    }
    return null
  }

  closeNotificationWindow(): void {
    if (this.notificationWindow && !this.notificationWindow.isDestroyed()) {
      this.notificationWindow.close()
      this.notificationWindow = null
    }
  }
}

export const windowManager = new WindowManager()
