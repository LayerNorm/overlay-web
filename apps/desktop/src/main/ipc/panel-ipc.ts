import { BrowserWindow, screen } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'
import {
  registerTrustedIpcWindow,
  type TrustedIpcWindowRole
} from '../services/security/secure-ipc-main'
import { join } from 'path'
import { getResourcePath } from '../utils/resources'
import { setVisibleOnAllWorkspacesKeepDock } from '../utils/workspace-visibility'
import { is } from '@electron-toolkit/utils'
import { PanelType } from '../types'
import { panelManager } from '../services/panel-manager'
import { windowManager } from '../services/window-manager'
import { browserManager } from '../services/browser-manager'
import { systemUtils } from '../services/system-utils'
import { panelLatencyMarkHydrate, panelLatencyMarkPaint } from '../utils/panel-latency'

// Panel transcription destination state
// When set, transcription will be sent to this panel instead of being pasted
interface PanelTranscriptionDestination {
  panel: 'chat' | 'notebook'
  wasVisible: boolean // Whether panel was visible before recording started
}

let panelTranscriptionDestination: PanelTranscriptionDestination | null = null

// Exported functions for use by main process
export function setPanelTranscriptionDestination(
  panel: 'chat' | 'notebook',
  wasVisible: boolean
): void {
  panelTranscriptionDestination = { panel, wasVisible }
  console.log('[PanelIPC] Set transcription destination:', panelTranscriptionDestination)
}

export function clearPanelTranscriptionDestination(): void {
  console.log('[PanelIPC] Cleared transcription destination')
  panelTranscriptionDestination = null
}

export function getPanelTranscriptionDestination(): PanelTranscriptionDestination | null {
  return panelTranscriptionDestination
}

export function registerPanelIPC(): void {
  ipcMain.on(
    'panel:renderer-ready',
    (_evt, { panelType }: { panelType: 'chat' | 'notebook' | 'browser' }) => {
      if (panelType === 'chat' || panelType === 'notebook' || panelType === 'browser') {
        panelManager.markRendererReady(panelType)
      }
    }
  )

  ipcMain.on(
    'panel:latency',
    (_evt, {
      panelType,
      stage
    }: {
      panelType: 'chat' | 'notebook' | 'browser'
      stage: 'paint' | 'hydrate'
    }) => {
      if (stage === 'paint') {
        panelLatencyMarkPaint(panelType)
      } else if (stage === 'hydrate') {
        panelLatencyMarkHydrate(panelType)
      }
    }
  )

  // Detect selected text handler (for renderer to check before opening chat panel)
  ipcMain.handle('system:detect-selected-text', async () => {
    try {
      const context = await systemUtils.detectEditingMode()
      return {
        success: true,
        hasSelection: context.isEditing && context.selectedText.trim().length > 0,
        selectedText: context.selectedText
      }
    } catch (error) {
      console.error('[System] Failed to detect selected text:', error)
      return { success: false, hasSelection: false, selectedText: '' }
    }
  })

  // Close the current window (from the window that sent the request)
  ipcMain.handle('window:close-current', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (win && !win.isDestroyed()) {
      const url = win.webContents.getURL()
      const isDockablePanel = ['chat', 'notebook', 'browser'].some((panelType) =>
        url.includes(`window=${panelType}`)
      )
      if (isDockablePanel) {
        panelManager.destroyPanelWindow(win.id)
      } else {
        win.close()
      }
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle('window:set-zoom-factor', async (evt, zoomFactor: number) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win || win.isDestroyed()) return false
    browserManager.setWindowZoomFactor(win.id, zoomFactor)
    return true
  })

  // Panel window toggle handler - unified hide/show behavior
  // For chat, notebook, and browser panels: hides all if any visible, shows all if all hidden
  ipcMain.handle(
    'panel:toggle',
    async (_evt, { panelType, open }: { panelType: PanelType; open: boolean }) => {
      if (panelType === 'chat' || panelType === 'notebook' || panelType === 'browser') {
        // Use unified toggle - ignores 'open' param, just toggles visibility
        console.log(`[Panel Toggle IPC] Toggling ${panelType} visibility`)
        const result = panelManager.togglePanelVisibility(panelType)
        console.log(`[Panel Toggle IPC] Result: ${result.action}, count: ${result.count}`)
        return {
          action: result.action,
          count: result.count,
          isVisible: result.action === 'shown' || result.action === 'created'
        }
      } else {
        // Transcription panel keeps the old open/close behavior
        if (open) {
          panelManager.createPanelWindow(panelType)
        } else {
          panelManager.closePanelWindow(panelType)
        }
        return { action: open ? 'opened' : 'closed', count: 1, isVisible: open }
      }
    }
  )

  // Check if any panels of a type are visible
  ipcMain.handle(
    'panel:isVisible',
    async (_evt, { panelType }: { panelType: 'chat' | 'notebook' | 'browser' }) => {
      const allWindows = panelManager.getAllPanelWindows(panelType)
      const anyVisible = allWindows.some((win) => win.isVisible())
      console.log(
        `[Panel Visibility] ${panelType}: ${allWindows.length} windows, anyVisible: ${anyVisible}`
      )
      return { isVisible: anyVisible, windowCount: allWindows.length }
    }
  )

  // Close all panels of a type and save their states for reopening
  ipcMain.handle(
    'panel:closeAllAndSave',
    async (_evt, { panelType }: { panelType: 'chat' | 'notebook' }) => {
      const trackingMap =
        panelType === 'chat' ? panelManager.getOpenChatWindows() : panelManager.getOpenNoteWindows()
      const savedWindows =
        panelType === 'chat'
          ? panelManager.getSavedChatWindows()
          : panelManager.getSavedNoteWindows()

      // Clear previous saved states
      savedWindows.length = 0

      // Save state of all open windows and close them
      for (const [itemId, windowId] of trackingMap.entries()) {
        const win = BrowserWindow.fromId(windowId)
        if (win && !win.isDestroyed()) {
          const bounds = win.getBounds()
          savedWindows.push({
            itemId,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
          })
          win.close()
        }
      }

      return { success: true, closedCount: savedWindows.length }
    }
  )

  // Reopen all previously saved panels at their positions
  ipcMain.handle(
    'panel:reopenSaved',
    async (_evt, { panelType }: { panelType: 'chat' | 'notebook' }) => {
      const savedWindows =
        panelType === 'chat'
          ? panelManager.getSavedChatWindows()
          : panelManager.getSavedNoteWindows()

      if (savedWindows.length === 0) {
        // No saved windows, just open a new panel
        panelManager.createPanelWindow(panelType)
        return { success: true, openedCount: 1 }
      }

      const trackingMap =
        panelType === 'chat' ? panelManager.getOpenChatWindows() : panelManager.getOpenNoteWindows()
      const panelPositions = panelManager.getPanelPositions()
      const panelSizes = panelManager.getPanelSizes()

      // Reopen each saved window at its position
      for (const state of savedWindows) {
        const newWindow = new BrowserWindow({
          width: state.width,
          height: state.height,
          x: state.x,
          y: state.y,
          minWidth: 300,
          minHeight: 300,
          show: false,
          frame: false,
          transparent: true,
          resizable: true,
          focusable: true,
          alwaysOnTop: true,
          hasShadow: true,
          title: panelType === 'notebook' ? 'Overlay Notebook' : 'Overlay Chat',
          icon: getResourcePath('icon.png'),
          webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: true,
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
          }
        })
        registerTrustedIpcWindow(newWindow, panelType as TrustedIpcWindowRole)

        newWindow.once('ready-to-show', () => {
          setVisibleOnAllWorkspacesKeepDock(newWindow)
          newWindow.setAlwaysOnTop(true, 'floating')
          newWindow.show()
          newWindow.focus()
        })

        // Track the window
        trackingMap.set(state.itemId, newWindow.id)

        // Clean up on close
        newWindow.on('closed', () => {
          trackingMap.delete(state.itemId)
          BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send('panel:closed', panelType, state.itemId)
          })
        })

        // Save position when moved
        newWindow.on('moved', () => {
          const bounds = newWindow.getBounds()
          panelPositions[panelType] = { x: bounds.x, y: bounds.y }
          panelManager.savePanelPositions()
        })

        newWindow.on('resized', () => {
          const bounds = newWindow.getBounds()
          panelSizes[panelType] = { width: bounds.width, height: bounds.height }
          panelManager.savePanelPositions()
        })

        // Load the panel URL with itemId
        if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
          newWindow.loadURL(
            `${process.env['ELECTRON_RENDERER_URL']}?window=${panelType}&itemId=${state.itemId}`
          )
        } else {
          newWindow.loadFile(join(__dirname, '../renderer/index.html'), {
            query: { window: panelType, itemId: state.itemId }
          })
        }
      }

      const openedCount = savedWindows.length
      savedWindows.length = 0 // Clear after reopening
      return { success: true, openedCount }
    }
  )

  // Get count of open panels of a type
  ipcMain.handle(
    'panel:getOpenCount',
    async (_evt, { panelType }: { panelType: 'chat' | 'notebook' }) => {
      const trackingMap =
        panelType === 'chat' ? panelManager.getOpenChatWindows() : panelManager.getOpenNoteWindows()
      let count = 0
      for (const [, windowId] of trackingMap.entries()) {
        const win = BrowserWindow.fromId(windowId)
        if (win && !win.isDestroyed()) {
          count++
        }
      }
      return { count }
    }
  )

  // Check if there are saved panels to reopen
  ipcMain.handle(
    'panel:hasSavedPanels',
    async (_evt, { panelType }: { panelType: 'chat' | 'notebook' }) => {
      const savedWindows =
        panelType === 'chat'
          ? panelManager.getSavedChatWindows()
          : panelManager.getSavedNoteWindows()
      return { hasSaved: savedWindows.length > 0 }
    }
  )

  // Panel content protection handler (hide from screenshots)
  ipcMain.handle(
    'panel:setContentProtection',
    async (_evt, { panelType, enabled }: { panelType: PanelType; enabled: boolean }) => {
      const panelWindow = windowManager.findWindowByType(panelType)
      if (panelWindow) {
        panelWindow.setContentProtection(enabled)
        return { success: true }
      }
      return { success: false, error: 'Panel window not found' }
    }
  )

  // Check if an item (chat/note) is already open in a window
  ipcMain.handle(
    'panel:isItemOpen',
    async (_evt, { panelType, itemId }: { panelType: 'chat' | 'notebook'; itemId: string }) => {
      const trackingMap =
        panelType === 'chat' ? panelManager.getOpenChatWindows() : panelManager.getOpenNoteWindows()
      const windowId = trackingMap.get(itemId)
      if (windowId) {
        const win = BrowserWindow.fromId(windowId)
        if (win && !win.isDestroyed()) {
          return { isOpen: true, windowId }
        }
        // Window no longer exists, clean up tracking
        trackingMap.delete(itemId)
      }
      return { isOpen: false }
    }
  )

  // Open a chat or note in a new window
  ipcMain.handle(
    'panel:openInNewWindow',
    async (
      _evt,
      {
        panelType,
        itemId,
        position
      }: {
        panelType: 'chat' | 'notebook'
        itemId: string
        position?: { x: number; y: number; width: number; height: number }
      }
    ) => {
      // Check if already open
      const trackingMap =
        panelType === 'chat' ? panelManager.getOpenChatWindows() : panelManager.getOpenNoteWindows()
      const existingWindowId = trackingMap.get(itemId)
      if (existingWindowId) {
        const existingWin = BrowserWindow.fromId(existingWindowId)
        if (existingWin && !existingWin.isDestroyed()) {
          existingWin.focus()
          return {
            success: false,
            error: 'Item is already open in another window',
            windowId: existingWindowId
          }
        }
        // Clean up stale entry
        trackingMap.delete(itemId)
      }

      // Create new window with the specific item and optional position
      const newWindow = panelManager.createPanelWindow(panelType, {
        forceNew: true,
        itemId,
        position
      })
      if (newWindow) {
        return { success: true, windowId: newWindow.id }
      }
      return { success: false, error: 'Failed to create window' }
    }
  )

  // Register that a window is now showing a specific item
  ipcMain.handle(
    'panel:registerOpenItem',
    async (evt, { panelType, itemId }: { panelType: 'chat' | 'notebook'; itemId: string }) => {
      const win = BrowserWindow.fromWebContents(evt.sender)
      if (!win) return { success: false }

      const trackingMap =
        panelType === 'chat' ? panelManager.getOpenChatWindows() : panelManager.getOpenNoteWindows()

      // Remove old tracking for this window
      for (const [id, winId] of trackingMap.entries()) {
        if (winId === win.id) {
          trackingMap.delete(id)
          break
        }
      }

      // Add new tracking
      trackingMap.set(itemId, win.id)
      return { success: true }
    }
  )

  // Unregister an item from tracking (when switching to a different item in the same window)
  ipcMain.handle(
    'panel:unregisterOpenItem',
    async (evt, { panelType, itemId }: { panelType: 'chat' | 'notebook'; itemId: string }) => {
      const win = BrowserWindow.fromWebContents(evt.sender)
      if (!win) return { success: false }

      const trackingMap =
        panelType === 'chat' ? panelManager.getOpenChatWindows() : panelManager.getOpenNoteWindows()
      const existingWindowId = trackingMap.get(itemId)

      // Only unregister if this window owns the item
      if (existingWindowId === win.id) {
        trackingMap.delete(itemId)
      }
      return { success: true }
    }
  )

  // Get all open items for a panel type
  ipcMain.handle(
    'panel:getOpenItems',
    async (_evt, { panelType }: { panelType: 'chat' | 'notebook' }) => {
      const trackingMap =
        panelType === 'chat' ? panelManager.getOpenChatWindows() : panelManager.getOpenNoteWindows()
      const openItems: string[] = []

      for (const [itemId, windowId] of trackingMap.entries()) {
        const win = BrowserWindow.fromId(windowId)
        if (win && !win.isDestroyed()) {
          openItems.push(itemId)
        } else {
          // Clean up stale entries
          trackingMap.delete(itemId)
        }
      }

      return { openItems }
    }
  )

  // Transcription panel handler - send transcription text to panel
  ipcMain.handle('transcription:send-to-panel', async (_evt, text: string) => {
    const existingPanel = windowManager.findWindowByType('transcription')

    if (existingPanel) {
      // Panel already exists and loaded - send text immediately
      existingPanel.webContents.send('transcription:text', text)
      existingPanel.focus()
      return { success: true }
    }

    // Create new panel and wait for it to fully load
    panelManager.createPanelWindow('transcription')

    // Wait for the panel to be ready
    return new Promise((resolve) => {
      const checkPanel = setInterval(() => {
        const panel = windowManager.findWindowByType('transcription')
        if (panel) {
          clearInterval(checkPanel)
          // Wait for did-finish-load event
          panel.webContents.once('did-finish-load', () => {
            // Small delay to ensure React has mounted
            setTimeout(() => {
              panel.webContents.send('transcription:text', text)
              resolve({ success: true })
            }, 100)
          })
          // If already loaded, send immediately
          if (!panel.webContents.isLoading()) {
            setTimeout(() => {
              panel.webContents.send('transcription:text', text)
              resolve({ success: true })
            }, 100)
          }
        }
      }, 50)

      // Timeout after 3 seconds
      setTimeout(() => {
        clearInterval(checkPanel)
        resolve({ success: false, error: 'Timeout waiting for panel' })
      }, 3000)
    })
  })

  // Panel transcription destination handlers - for hold-to-transcribe feature
  ipcMain.handle('transcription:get-panel-destination', async () => {
    return panelTranscriptionDestination
  })

  ipcMain.handle('transcription:clear-panel-destination', async () => {
    clearPanelTranscriptionDestination()
    return { success: true }
  })

  // Window drag handlers for Cmd+drag functionality
  ipcMain.handle('window:start-drag', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win || win.isDestroyed()) return { success: false }
    const bounds = win.getBounds()
    return { success: true, x: bounds.x, y: bounds.y }
  })

  ipcMain.handle(
    'window:drag-move',
    async (evt, { deltaX, deltaY }: { deltaX: number; deltaY: number }) => {
      const win = BrowserWindow.fromWebContents(evt.sender)
      if (!win || win.isDestroyed()) return { success: false }
      const bounds = win.getBounds()
      win.setPosition(bounds.x + deltaX, bounds.y + deltaY)
      return { success: true }
    }
  )

  // Traffic light button handlers
  // Destroy/close panel completely (so new one appears on next hotkey)
  ipcMain.handle('panel:destroy', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (win && !win.isDestroyed()) {
      panelManager.destroyPanelWindow(win.id)
      return { success: true }
    }
    return { success: false }
  })

  // Hide/minimize panel (can be shown again via hotkey)
  ipcMain.handle(
    'panel:hide',
    async (
      evt,
      { panelType }: { panelType: 'chat' | 'notebook' | 'browser' | 'transcription' }
    ) => {
      const win = BrowserWindow.fromWebContents(evt.sender)
      if (win && !win.isDestroyed()) {
        panelManager.hidePanelWindow(win.id, panelType)
        return { success: true }
      }
      return { success: false }
    }
  )

  // Maximize/restore panel with padding (not fullscreen)
  ipcMain.handle('panel:maximize', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (win && !win.isDestroyed()) {
      const result = panelManager.maximizePanelWindow(win.id)
      return { success: true, isMaximized: result.isMaximized }
    }
    return { success: false, isMaximized: false }
  })

  // Set ignore mouse events for click-through (used by dockable panels)
  ipcMain.handle(
    'panel:set-ignore-mouse',
    async (evt, { ignore, forward }: { ignore: boolean; forward?: boolean }) => {
      const win = BrowserWindow.fromWebContents(evt.sender)
      if (!win || win.isDestroyed()) return { success: false }
      if (ignore) {
        win.setIgnoreMouseEvents(true, { forward: forward ?? true })
      } else {
        win.setIgnoreMouseEvents(false)
      }
      return { success: true }
    }
  )

  // Get screen bounds for the display the window is on
  ipcMain.handle('panel:get-screen-bounds', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win || win.isDestroyed()) return { success: false }
    const display = screen.getDisplayMatching(win.getBounds())
    return {
      success: true,
      bounds: display.bounds,
      workArea: display.workArea
    }
  })

  // Get all displays (for multi-monitor awareness)
  ipcMain.handle('panel:get-all-displays', async () => {
    const displays = screen.getAllDisplays()
    return {
      success: true,
      displays: displays.map((d) => ({
        id: d.id,
        bounds: d.bounds,
        workArea: d.workArea,
        scaleFactor: d.scaleFactor
      }))
    }
  })

  // Move the BrowserWindow to cover a specific display by screen point
  // Used when dragging a panel across monitor boundaries
  ipcMain.handle(
    'panel:move-to-display',
    async (evt, { screenX, screenY }: { screenX: number; screenY: number }) => {
      const win = BrowserWindow.fromWebContents(evt.sender)
      if (!win || win.isDestroyed()) return { success: false }
      const targetDisplay = screen.getDisplayNearestPoint({ x: screenX, y: screenY })
      win.setBounds(targetDisplay.bounds)
      return {
        success: true,
        bounds: targetDisplay.bounds,
        workArea: targetDisplay.workArea
      }
    }
  )
}
