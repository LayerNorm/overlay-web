import { BrowserWindow, screen, app, systemPreferences } from 'electron'
import { join } from 'path'
import { getResourcePath } from '../utils/resources'
import { setVisibleOnAllWorkspacesKeepDock } from '../utils/workspace-visibility'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { is } from '@electron-toolkit/utils'
import {
  PanelType,
  CreatePanelOptions,
  PanelPositions,
  PanelSizes,
  PreloadedPanels,
  HiddenPanelWindows,
  SavedWindowState,
  ToggleResult,
  WindowType
} from '../types'
import { windowManager } from './window-manager'
import { browserManager } from './browser-manager'
import { panelLatencyMarkShow, panelLatencyMarkToggleStart, isPanelLatencyEnabled } from '../utils/panel-latency'
import { yieldFocusAfterLastPanelHidden } from '../utils/yield-focus'
import { registerTrustedIpcWindow, type TrustedIpcWindowRole } from './security/secure-ipc-main'

type DockablePreloadPanel = 'chat' | 'notebook' | 'browser'

class PanelManager {
  // Panel window position and size storage
  private panelPositions: PanelPositions = {}
  private panelSizes: PanelSizes = {}

  // Pre-created hidden panel windows for faster activation
  private preloadedPanels: PreloadedPanels = {}
  private preloadedReady = new Set<DockablePreloadPanel>()
  private recoveringPanelRenderers = new Set<number>()
  private destroyingPanelWindows = new Set<number>()
  private pendingOpenStateWrite: ReturnType<typeof setImmediate> | null = null

  // Track which items are open in which windows (for preventing duplicate windows)
  // Maps itemId to windowId for chats and notes
  // IMPORTANT: Only tracks windows opened via "open in new window", NOT the main panel
  private openChatWindows: Map<string, number> = new Map()
  private openNoteWindows: Map<string, number> = new Map()

  // Track previously open windows for reopening (with positions)
  private savedChatWindows: SavedWindowState[] = []
  private savedNoteWindows: SavedWindowState[] = []

  // Track all hidden windows for hide/show toggle behavior
  // When user hides panels, we keep them alive but hidden, then show them again on next toggle
  private hiddenPanelWindows: HiddenPanelWindows = {
    chat: new Set(),
    notebook: new Set(),
    browser: new Set()
  }

  // Track if app is quitting to allow window close
  private isQuitting = false

  // Track last known display bounds for monitor geometry changes
  private lastDisplayBounds: { x: number; y: number; width: number; height: number } | null = null
  private panelSpaceChangeSubscriptionId: number | null = null
  private lastPanelSpaceReassertAt = 0

  /** Which dockable panels were open last — restored when Show Panels On Startup is on. */
  private openOnStartup: { chat: boolean; notebook: boolean; browser: boolean } = {
    chat: false,
    notebook: false,
    browser: false
  }

  constructor() {
    // Listen for app quit to allow windows to close
    app.on('before-quit', () => {
      this.persistOpenPanelState()
      this.isQuitting = true
      this.unsubscribePanelSpaceChanges()
    })

    // Listen for display changes (dock show/hide, resolution change)
    // Deferred until app is ready because 'screen' module requires it
    app.whenReady().then(() => {
      // Immediate response to display setting changes
      screen.on('display-metrics-changed', () => {
        this.checkAndUpdateDisplayBounds()
      })
      // Poll display bounds to catch resolution and monitor layout changes
      this.lastDisplayBounds = { ...screen.getPrimaryDisplay().bounds }
      setInterval(() => this.checkAndUpdateDisplayBounds(), 1000)
      this.subscribePanelSpaceChanges()
    })
  }

  private subscribePanelSpaceChanges(): void {
    if (process.platform !== 'darwin' || this.panelSpaceChangeSubscriptionId !== null) return
    this.panelSpaceChangeSubscriptionId = systemPreferences.subscribeWorkspaceNotification(
      'NSWorkspaceActiveSpaceDidChangeNotification',
      () => {
        const now = Date.now()
        if (now - this.lastPanelSpaceReassertAt < 300) return
        this.lastPanelSpaceReassertAt = now
        this.reassertVisibleDockablePanels()
      }
    )
  }

  private unsubscribePanelSpaceChanges(): void {
    if (this.panelSpaceChangeSubscriptionId === null) return
    systemPreferences.unsubscribeWorkspaceNotification(this.panelSpaceChangeSubscriptionId)
    this.panelSpaceChangeSubscriptionId = null
  }

  private reassertVisibleDockablePanels(): void {
    const targetBounds = this.getCurrentDisplayBounds()
    const panelTypes: DockablePreloadPanel[] = ['chat', 'notebook', 'browser']
    for (const panelType of panelTypes) {
      for (const win of this.getAllPanelWindows(panelType)) {
        if (win.isDestroyed() || !win.isVisible()) continue
        this.prepareDockablePanelWindow(win, targetBounds)
        this.applyDockablePanelVisibility(win, false)
      }
    }
  }

  // Check if display bounds changed and update dockable windows if so
  private checkAndUpdateDisplayBounds(): void {
    const bounds = screen.getPrimaryDisplay().bounds
    if (
      this.lastDisplayBounds &&
      bounds.x === this.lastDisplayBounds.x &&
      bounds.y === this.lastDisplayBounds.y &&
      bounds.width === this.lastDisplayBounds.width &&
      bounds.height === this.lastDisplayBounds.height
    ) {
      return // No change
    }
    console.log('[PanelManager] Display bounds changed:', this.lastDisplayBounds, '->', bounds)
    this.lastDisplayBounds = { ...bounds }
    this.updateDockableWindowBounds()
  }

  // Resize all fullscreen panel BrowserWindows to match the current display bounds.
  // This covers both dockable panels and the overlay (which is now also fullscreen).
  private updateDockableWindowBounds(): void {
    const fullscreenTypes: WindowType[] = ['chat', 'notebook', 'browser', 'overlay']
    for (const windowType of fullscreenTypes) {
      const win = windowManager.findWindowByType(windowType)
      if (win && !win.isDestroyed() && win.isVisible()) {
        const display = screen.getDisplayMatching(win.getBounds())
        win.setBounds(display.bounds)
      }
    }
  }

  private getCurrentDisplayBounds(): Electron.Rectangle {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds
  }

  private prepareDockablePanelWindow(
    win: BrowserWindow,
    bounds = this.getCurrentDisplayBounds()
  ): void {
    // Always target the display under the cursor so hotkeys open the panel on
    // whatever screen the user is currently using — not primary / last Space.
    win.setBounds(bounds)
    win.setAlwaysOnTop(true, 'screen-saver')
  }

  private applyDockablePanelVisibility(win: BrowserWindow, focus: boolean): void {
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.showInactive()
    win.moveTop()
    if (focus) win.focus()
  }

  showPanelWindow(win: BrowserWindow, focus = true): void {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    this.prepareDockablePanelWindow(win)
    // Match overlay: stay on all Spaces / over fullscreen without the
    // process-type transform that switches Spaces on multi-monitor Macs.
    this.applyDockablePanelVisibility(win, focus)
  }

  private getOpenPanelStatePath(): string {
    return join(app.getPath('userData'), 'open-panels.json')
  }

  loadOpenPanelState(): void {
    try {
      const path = this.getOpenPanelStatePath()
      if (!existsSync(path)) return
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
        chat?: boolean
        notebook?: boolean
        browser?: boolean
      }
      this.openOnStartup = {
        chat: parsed.chat === true,
        notebook: parsed.notebook === true,
        browser: parsed.browser === true
      }
    } catch (error) {
      console.error('[PanelManager] Failed to load open panel state:', error)
    }
  }

  persistOpenPanelState(): void {
    try {
      const state = {
        chat: this.getAllPanelWindows('chat').some((win) => win.isVisible()),
        notebook: this.getAllPanelWindows('notebook').some((win) => win.isVisible()),
        browser: this.getAllPanelWindows('browser').some((win) => win.isVisible())
      }
      this.openOnStartup = state
      writeFileSync(this.getOpenPanelStatePath(), JSON.stringify(state, null, 2), 'utf-8')
    } catch (error) {
      console.error('[PanelManager] Failed to persist open panel state:', error)
    }
  }

  private markPanelOpenState(
    panelType: 'chat' | 'notebook' | 'browser',
    isOpen: boolean
  ): void {
    this.openOnStartup[panelType] = isOpen
    if (this.pendingOpenStateWrite) {
      clearImmediate(this.pendingOpenStateWrite)
    }
    this.pendingOpenStateWrite = setImmediate(() => {
      this.pendingOpenStateWrite = null
      try {
        writeFileSync(
          this.getOpenPanelStatePath(),
          JSON.stringify(this.openOnStartup, null, 2),
          'utf-8'
        )
      } catch (error) {
        console.error('[PanelManager] Failed to save open panel state:', error)
      }
    })
  }

  markRendererReady(panelType: DockablePreloadPanel): void {
    this.preloadedReady.add(panelType)
    console.log(`[PanelManager] ${panelType} renderer ready`)
  }

  isPreloadReady(panelType: DockablePreloadPanel): boolean {
    return this.preloadedReady.has(panelType)
  }

  private clearPreloadReady(panelType: DockablePreloadPanel): void {
    this.preloadedReady.delete(panelType)
  }

  private broadcastPanelVisibility(
    panelType: 'chat' | 'notebook' | 'browser',
    isVisible: boolean
  ): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return
      win.webContents.send('panel:visibility-changed', panelType, isVisible)
    })
  }

  private recoverPanelRenderer(
    panelWindow: BrowserWindow,
    panelType: 'chat' | 'notebook' | 'browser',
    reason: string
  ): void {
    if (this.isQuitting || panelWindow.isDestroyed()) return
    if (this.destroyingPanelWindows.has(panelWindow.id)) return
    if (this.recoveringPanelRenderers.has(panelWindow.id)) return

    const wasVisible = panelWindow.isVisible()
    this.recoveringPanelRenderers.add(panelWindow.id)
    console.warn(`[Panel] Recovering ${panelType} renderer (${reason})`, panelWindow.id)

    const finishRecovery = (): void => {
      this.recoveringPanelRenderers.delete(panelWindow.id)
      if (panelWindow.isDestroyed()) return
      if (wasVisible && !this.hiddenPanelWindows[panelType].has(panelWindow.id)) {
        this.showPanelWindow(panelWindow, false)
      } else {
        panelWindow.hide()
      }
    }

    panelWindow.webContents.once('did-finish-load', finishRecovery)
    try {
      panelWindow.webContents.reload()
    } catch (error) {
      panelWindow.webContents.removeListener('did-finish-load', finishRecovery)
      this.recoveringPanelRenderers.delete(panelWindow.id)
      console.error(`[Panel] Failed to reload ${panelType} renderer:`, error)
    }
  }

  /**
   * Apply Show Panels On Startup: restore last-open chat/notebook/browser panels,
   * or keep them hidden when the setting is off.
   */
  applyStartupPanelVisibility(showPanels: boolean): void {
    this.loadOpenPanelState()

    if (!showPanels) {
      this.hideAllVisiblePanels()
      console.log('[PanelManager] Show Panels On Startup is off — keeping panels hidden')
      return
    }

    const toOpen: Array<'chat' | 'notebook' | 'browser'> = []
    if (this.openOnStartup.chat) toOpen.push('chat')
    if (this.openOnStartup.notebook) toOpen.push('notebook')
    if (this.openOnStartup.browser) toOpen.push('browser')

    if (toOpen.length === 0) {
      console.log('[PanelManager] Show Panels On Startup is on — no panels were open last time')
      return
    }

    console.log('[PanelManager] Restoring panels on startup:', toOpen.join(', '))
    for (const panelType of toOpen) {
      const existing = this.getAllPanelWindows(panelType)
      if (existing.length === 0) {
        this.createPanelWindow(panelType, { show: true })
      } else {
        for (const win of existing) {
          if (!win.isVisible()) this.showPanelWindow(win, false)
        }
      }
      this.hiddenPanelWindows[panelType].clear()
      this.broadcastPanelVisibility(panelType, true)
    }
  }

  // Getters for tracking maps
  getOpenChatWindows(): Map<string, number> {
    return this.openChatWindows
  }

  getOpenNoteWindows(): Map<string, number> {
    return this.openNoteWindows
  }

  getSavedChatWindows(): SavedWindowState[] {
    return this.savedChatWindows
  }

  getSavedNoteWindows(): SavedWindowState[] {
    return this.savedNoteWindows
  }

  loadPanelPositions(): void {
    try {
      const positionsPath = join(app.getPath('userData'), 'panel-positions.json')
      if (existsSync(positionsPath)) {
        const data = readFileSync(positionsPath, 'utf-8')
        const saved = JSON.parse(data)
        if (saved.positions?.notebook) this.panelPositions.notebook = saved.positions.notebook
        if (saved.positions?.chat) this.panelPositions.chat = saved.positions.chat
        if (saved.positions?.transcription)
          this.panelPositions.transcription = saved.positions.transcription
        if (saved.positions?.browser) this.panelPositions.browser = saved.positions.browser
        if (saved.sizes?.notebook) this.panelSizes.notebook = saved.sizes.notebook
        if (saved.sizes?.chat) this.panelSizes.chat = saved.sizes.chat
        if (saved.sizes?.transcription) this.panelSizes.transcription = saved.sizes.transcription
        if (saved.sizes?.browser) this.panelSizes.browser = saved.sizes.browser
      }
    } catch (error) {
      console.error('[Panel] Failed to load positions:', error)
    }
  }

  savePanelPositions(): void {
    try {
      const positionsPath = join(app.getPath('userData'), 'panel-positions.json')
      const data = { positions: this.panelPositions, sizes: this.panelSizes }
      writeFileSync(positionsPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      console.error('[Panel] Failed to save positions:', error)
    }
  }

  // Helper function to get ALL windows of a panel type (main panels + itemId windows)
  getAllPanelWindows(panelType: 'chat' | 'notebook' | 'browser'): BrowserWindow[] {
    const windowIds = new Set<number>()
    const windows: BrowserWindow[] = []
    const trackingMap =
      panelType === 'chat'
        ? this.openChatWindows
        : panelType === 'notebook'
          ? this.openNoteWindows
          : null
    const hiddenSet = this.hiddenPanelWindows[panelType]

    // Get all tracked itemId windows (browser doesn't have itemId tracking)
    if (trackingMap) {
      for (const [, windowId] of trackingMap.entries()) {
        const win = BrowserWindow.fromId(windowId)
        if (win && !win.isDestroyed() && !windowIds.has(win.id)) {
          windowIds.add(win.id)
          windows.push(win)
        }
      }
    }

    // Get ALL windows of this type from BrowserWindow.getAllWindows()
    // This finds all main panel windows (not just the first one)
    const allBrowserWindows = BrowserWindow.getAllWindows()
    for (const win of allBrowserWindows) {
      if (!win.isDestroyed() && !windowIds.has(win.id)) {
        try {
          const url = win.webContents.getURL()
          if (url.includes(`window=${panelType}`)) {
            windowIds.add(win.id)
            windows.push(win)
          }
        } catch {
          // Window might be in process of being destroyed
        }
      }
    }

    // Also check hidden windows tracking
    for (const windowId of hiddenSet) {
      if (!windowIds.has(windowId)) {
        const win = BrowserWindow.fromId(windowId)
        if (win && !win.isDestroyed()) {
          windowIds.add(win.id)
          windows.push(win)
        }
      }
    }

    console.log(
      `[getAllPanelWindows] ${panelType}: found ${windows.length} windows (ids: ${Array.from(windowIds).join(', ')})`
    )

    return windows
  }

  // Unified toggle function - hides all if any visible, shows all if all hidden
  togglePanelVisibility(panelType: 'chat' | 'notebook' | 'browser'): ToggleResult {
    panelLatencyMarkToggleStart(panelType)
    if (this.isPanelTypeVisible(panelType)) {
      const targetDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const visibleOnTargetDisplay = this.getAllPanelWindows(panelType).some(
        (win) =>
          !win.isDestroyed() &&
          win.isVisible() &&
          screen.getDisplayMatching(win.getBounds()).id === targetDisplay.id
      )
      if (!visibleOnTargetDisplay) {
        return this.showPanelType(panelType)
      }
      return this.hidePanelType(panelType)
    }
    return this.showPanelType(panelType)
  }

  isPanelTypeVisible(panelType: 'chat' | 'notebook' | 'browser'): boolean {
    return this.getAllPanelWindows(panelType).some((win) => !win.isDestroyed() && win.isVisible())
  }

  showPanelType(panelType: 'chat' | 'notebook' | 'browser'): ToggleResult {
    panelLatencyMarkToggleStart(panelType)
    const allWindows = this.getAllPanelWindows(panelType)
    const hiddenSet = this.hiddenPanelWindows[panelType]

    console.log(
      `[Panel Show] ${panelType}: found ${allWindows.length} windows, ${hiddenSet.size} tracked as hidden`
    )

    let result: ToggleResult

    if (allWindows.length === 0) {
      console.log(`[Panel Show] No windows exist, creating new ${panelType} panel`)
      this.createPanelWindow(panelType)
      result = { action: 'created', count: 1 }
    } else {
      let shownCount = 0
      for (const win of allWindows) {
        const wasVisible = win.isVisible()
        this.showPanelWindow(win, false)
        if (!wasVisible) shownCount++
        console.log(`[Panel Show] Presented window ${win.id} on the active display`)
      }
      hiddenSet.clear()

      if (allWindows.length > 0) {
        const focusedWindow = allWindows[allWindows.length - 1]
        focusedWindow.moveTop()
        focusedWindow.focus()
      }

      result = { action: 'shown', count: shownCount }
    }

    panelLatencyMarkShow(panelType)
    this.markPanelOpenState(panelType, true)
    this.broadcastPanelVisibility(panelType, true)

    return result
  }

  hidePanelType(panelType: 'chat' | 'notebook' | 'browser'): ToggleResult {
    panelLatencyMarkToggleStart(panelType)
    const allWindows = this.getAllPanelWindows(panelType)
    const hiddenSet = this.hiddenPanelWindows[panelType]

    console.log(`[Panel Hide] ${panelType}: hiding ${allWindows.length} windows`)
    hiddenSet.clear()
    for (const win of allWindows) {
      if (win.isVisible()) {
        hiddenSet.add(win.id)
        win.hide()
        console.log(`[Panel Hide] Hidden window ${win.id}`)
      }
    }

    const result: ToggleResult = { action: 'hidden', count: hiddenSet.size }
    this.markPanelOpenState(panelType, false)
    this.broadcastPanelVisibility(panelType, false)

    this.maybeYieldFocusAfterPanelsHidden()
    return result
  }

  /**
   * When no chat/notebook/browser panel remains visible, hand focus back to
   * the app underneath so Overlay (pill) doesn't eat shortcuts like Cmd+W.
   */
  maybeYieldFocusAfterPanelsHidden(): void {
    const panelTypes: Array<'chat' | 'notebook' | 'browser'> = ['chat', 'notebook', 'browser']
    if (panelTypes.some((type) => this.isPanelTypeVisible(type))) {
      return
    }

    const restore: BrowserWindow[] = []
    const overlay = windowManager.ensureOverlayWindowVisible()
    if (!overlay.isDestroyed()) {
      restore.push(overlay)
    }
    const main = windowManager.findWindowByType('main')
    if (main && !main.isDestroyed() && main.isVisible()) {
      restore.push(main)
    }
    const notification = windowManager.getNotificationWindow()
    if (notification && !notification.isDestroyed() && notification.isVisible()) {
      restore.push(notification)
    }

    if (main && !main.isDestroyed() && main.isVisible()) {
      console.log('[PanelManager] Last panel hidden — preserving visible MainWindow')
    } else {
      console.log('[PanelManager] Last panel hidden — yielding focus to previous app')
    }
    yieldFocusAfterLastPanelHidden(main, restore)

    // Re-assert overlay click-through after showInactive (focus yield).
    if (!overlay.isDestroyed()) {
      overlay.setIgnoreMouseEvents(true, { forward: true })
      overlay.setAlwaysOnTop(true, 'screen-saver')
    }
  }

  createPanelWindow(panelType: PanelType, options: CreatePanelOptions = {}): BrowserWindow | void {
    const { show = true, preload = false, itemId, forceNew = false, position } = options

    // Check if we have a preloaded panel ready (only for non-forceNew, non-itemId cases)
    const preloadedKey = panelType as DockablePreloadPanel
    const preloadedPanel = this.preloadedPanels[preloadedKey]
    if (
      show &&
      !forceNew &&
      !itemId &&
      (panelType === 'chat' || panelType === 'notebook' || panelType === 'browser') &&
      preloadedPanel
    ) {
      if (preloadedPanel.isDestroyed()) {
        delete this.preloadedPanels[preloadedKey]
        this.clearPreloadReady(preloadedKey)
      } else {
        delete this.preloadedPanels[preloadedKey]

        if (isPanelLatencyEnabled() && !this.preloadedReady.has(preloadedKey)) {
          console.warn(`[PanelManager] Showing ${preloadedKey} preload before renderer-ready`)
        }
        this.clearPreloadReady(preloadedKey)

        // Only dockable panels are preloaded, and they always use fullscreen bounds.
        preloadedPanel.setIgnoreMouseEvents(true, { forward: true })
        this.showPanelWindow(preloadedPanel)
        this.markPanelOpenState(preloadedKey, true)

        // Pre-create a new hidden panel for next time
        setTimeout(() => this.preloadPanelWindow(preloadedKey), 100)
        return preloadedPanel
      }
    }

    // Check if panel already exists (only for non-forceNew cases)
    if (!forceNew) {
      const existingPanel = windowManager.findWindowByType(panelType)
      if (existingPanel) {
        if (show) {
          if (panelType === 'chat' || panelType === 'notebook' || panelType === 'browser') {
            this.showPanelWindow(existingPanel)
            this.markPanelOpenState(panelType, true)
          } else {
            existingPanel.show()
            existingPanel.focus()
          }
        }
        return existingPanel
      }
    }

    // Load saved positions on first panel creation
    if (!this.panelPositions.notebook && !this.panelPositions.chat) {
      this.loadPanelPositions()
    }

    const DEFAULT_SIZE = 600
    const BROWSER_DEFAULT_WIDTH = 600
    const BROWSER_DEFAULT_HEIGHT = 600
    const MIN_SIZE = 300

    // Dockable panels (chat, notebook, browser) use fullscreen transparent windows with click-through
    const isDockable = panelType === 'chat' || panelType === 'notebook' || panelType === 'browser'

    // Use position override size, saved size, or default (browser has different default)
    const defaultWidth = panelType === 'browser' ? BROWSER_DEFAULT_WIDTH : DEFAULT_SIZE
    const defaultHeight = panelType === 'browser' ? BROWSER_DEFAULT_HEIGHT : DEFAULT_SIZE
    const width = position?.width || this.panelSizes[panelType]?.width || defaultWidth
    const height = position?.height || this.panelSizes[panelType]?.height || defaultHeight

    // Get overlay window position to position panel relative to it
    const overlayWindow = windowManager.findWindowByType('overlay')
    let x: number, y: number

    if (position) {
      // Use explicit position override (for reopening saved panels)
      x = position.x
      y = position.y
    } else if (forceNew) {
      // For new windows opened via Cmd+T or "open in new window", always center on screen
      const display = screen.getPrimaryDisplay()
      const bounds = display.bounds
      x = Math.round(bounds.x + (bounds.width - width) / 2)
      y = Math.round(bounds.y + (bounds.height - height) / 2)
    } else if (this.panelPositions[panelType]) {
      // Use saved position
      x = this.panelPositions[panelType]!.x
      y = this.panelPositions[panelType]!.y
    } else if (overlayWindow) {
      // Position above overlay window
      const overlayBounds = overlayWindow.getBounds()
      x = Math.round(overlayBounds.x + (overlayBounds.width - width) / 2)
      y = Math.round(overlayBounds.y - height - 20)
    } else {
      // Fallback to center of screen
      const display = screen.getPrimaryDisplay()
      const bounds = display.bounds
      x = Math.round(bounds.x + (bounds.width - width) / 2)
      y = Math.round(bounds.y + (bounds.height - height) / 2)
    }

    // For dockable panels, override to fullscreen bounds
    let winX = x,
      winY = y,
      winWidth = width,
      winHeight = height
    if (isDockable) {
      const bounds = this.getCurrentDisplayBounds()
      winX = bounds.x
      winY = bounds.y
      winWidth = bounds.width
      winHeight = bounds.height
    }

    const panelWindow = new BrowserWindow({
      width: winWidth,
      height: winHeight,
      minWidth: isDockable ? undefined : MIN_SIZE,
      minHeight: isDockable ? undefined : MIN_SIZE,
      x: winX,
      y: winY,
      show: false,
      // NSPanel-style: floats over fullscreen Spaces and joins all desktops
      // without transforming the process to a UIElement (accessory) app — same
      // model as the overlay pill. A regular window + setVisibleOnAllWorkspaces
      // without skipTransformProcessType can yank Mission Control to another Space.
      ...(process.platform === 'darwin' && isDockable ? { type: 'panel' as const } : {}),
      frame: false,
      transparent: true,
      resizable: true,
      movable: true,
      focusable: true,
      alwaysOnTop: true,
      hasShadow: !isDockable,
      enableLargerThanScreen: isDockable,
      title:
        panelType === 'notebook'
          ? 'Overlay Notebook'
          : panelType === 'chat'
            ? 'Overlay Chat'
            : panelType === 'browser'
              ? 'Overlay Browser'
              : 'Overlay Transcription',
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
    registerTrustedIpcWindow(panelWindow, panelType as TrustedIpcWindowRole)

    // For dockable panels, force exact bounds after creation to ensure full screen coverage
    if (isDockable) {
      panelWindow.setBounds({ x: winX, y: winY, width: winWidth, height: winHeight })
    }

    // Wait for window to be ready before showing (fixes first hotkey press not showing panel)
    if (show) {
      panelWindow.once('ready-to-show', () => {
        panelWindow.setAlwaysOnTop(true, isDockable ? 'screen-saver' : 'floating')
        if (isDockable) {
          // Force bounds again after ready-to-show to ensure full coverage on macOS
          panelWindow.setIgnoreMouseEvents(true, { forward: true })
          this.showPanelWindow(panelWindow)
          if (panelType === 'chat' || panelType === 'notebook' || panelType === 'browser') {
            this.markPanelOpenState(panelType, true)
          }
        } else {
          setVisibleOnAllWorkspacesKeepDock(panelWindow)
          panelWindow.show()
          panelWindow.focus()
        }
      })
    } else {
      // Keep preloaded / hidden panels truly hidden. Calling
      // setVisibleOnAllWorkspacesKeepDock here can surface them on macOS.
      panelWindow.setAlwaysOnTop(true, isDockable ? 'screen-saver' : 'floating')
      if (isDockable) {
        panelWindow.setBounds({ x: winX, y: winY, width: winWidth, height: winHeight })
        panelWindow.setIgnoreMouseEvents(true, { forward: true })
      }
    }

    // Build query params including optional itemId
    const queryParams: Record<string, string> = { window: panelType }
    if (itemId) {
      queryParams.itemId = itemId
    }

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const urlParams = new URLSearchParams(queryParams).toString()
      panelWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + `?${urlParams}`)
    } else {
      panelWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        query: queryParams
      })
    }

    // Store preloaded panel reference
    if (
      preload &&
      (panelType === 'notebook' || panelType === 'chat' || panelType === 'browser')
    ) {
      this.preloadedPanels[panelType] = panelWindow
      this.clearPreloadReady(panelType)
    }

    // Prevent links from opening in new Electron windows - let renderer handle them
    panelWindow.webContents.setWindowOpenHandler(() => {
      return { action: 'deny' }
    })

    if (panelType === 'chat' || panelType === 'notebook' || panelType === 'browser') {
      panelWindow.on('close', (event) => {
        if (this.isQuitting) return
        event.preventDefault()
        this.hidePanelWindow(panelWindow.id, panelType)
      })

      panelWindow.webContents.on('render-process-gone', (_event, details) => {
        this.recoverPanelRenderer(panelWindow, panelType, details.reason)
      })
    }

    // Save position/size when window is moved/resized (non-dockable only)
    if (!isDockable) {
      panelWindow.on('moved', () => {
        const bounds = panelWindow.getBounds()
        this.panelPositions[panelType] = { x: bounds.x, y: bounds.y }
        this.savePanelPositions()
      })

      panelWindow.on('resized', () => {
        const bounds = panelWindow.getBounds()
        this.panelSizes[panelType] = { width: bounds.width, height: bounds.height }
        this.savePanelPositions()
      })
    }

    // Store last bounds before close for position tracking
    let lastBounds = panelWindow.getBounds()
    panelWindow.on('move', () => {
      lastBounds = panelWindow.getBounds()
    })
    panelWindow.on('resize', () => {
      lastBounds = panelWindow.getBounds()
    })

    // Clean up on close
    panelWindow.on('closed', () => {
      this.recoveringPanelRenderers.delete(panelWindow.id)
      this.destroyingPanelWindows.delete(panelWindow.id)
      this.originalBounds.delete(panelWindow.id)
      // Clear from preloaded if it was preloaded
      const preloadKey = panelType as DockablePreloadPanel
      if (
        (panelType === 'chat' || panelType === 'notebook' || panelType === 'browser') &&
        this.preloadedPanels[preloadKey] === panelWindow
      ) {
        delete this.preloadedPanels[preloadKey]
        this.clearPreloadReady(preloadKey)
      }
      // Clear from open item tracking
      if (itemId) {
        if (panelType === 'chat') {
          this.openChatWindows.delete(itemId)
        } else if (panelType === 'notebook') {
          this.openNoteWindows.delete(itemId)
        }
      }
      // Clear from hidden windows tracking
      if (panelType === 'chat' || panelType === 'notebook' || panelType === 'browser') {
        this.hiddenPanelWindows[panelType].delete(panelWindow.id)
        const stillOpen = this.getAllPanelWindows(panelType).some(
          (win) => !win.isDestroyed() && win.id !== panelWindow.id && win.isVisible()
        )
        this.markPanelOpenState(panelType, stillOpen)
        console.log(
          `[Panel Close] Removed window ${panelWindow.id} from ${panelType} hidden tracking`
        )
        // Defer: other closed-handler bookkeeping may still be running, and
        // isPanelTypeVisible needs the window gone from getAllWindows.
        setImmediate(() => this.maybeYieldFocusAfterPanelsHidden())
      }
      // Notify all windows that a panel was closed (with itemId, position data)
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('panel:closed', panelType, itemId, {
          x: lastBounds.x,
          y: lastBounds.y,
          width: lastBounds.width,
          height: lastBounds.height
        })
      })
    })

    // Track open item
    if (itemId) {
      if (panelType === 'chat') {
        this.openChatWindows.set(itemId, panelWindow.id)
      } else if (panelType === 'notebook') {
        this.openNoteWindows.set(itemId, panelWindow.id)
      }
    }

    // Register browser windows with browserManager for WebContentsView management
    if (panelType === 'browser') {
      browserManager.registerWindow(panelWindow, { enableClickThrough: true })
    }

    return panelWindow
  }

  // Pre-create a hidden panel window for faster activation
  preloadPanelWindow(panelType: DockablePreloadPanel): void {
    const existing = this.preloadedPanels[panelType]
    if (existing && !existing.isDestroyed()) {
      return // Already preloaded
    }
    if (existing?.isDestroyed()) {
      delete this.preloadedPanels[panelType]
      this.clearPreloadReady(panelType)
    }
    console.log(`[Panel] Preloading ${panelType} panel window`)
    this.createPanelWindow(panelType, { show: false, preload: true })
  }

  // Preload dockable panel windows shortly after app is ready
  preloadAllPanels(): void {
    setTimeout(() => {
      this.preloadPanelWindow('chat')
      this.preloadPanelWindow('notebook')
      this.preloadPanelWindow('browser')
    }, 300)
  }

  closePanelWindow(panelType: PanelType): void {
    const panelWindow = windowManager.findWindowByType(panelType)
    if (panelWindow) {
      this.destroyPanelWindow(panelWindow.id)
    }
  }

  // Close all panel windows (used when signing out)
  closeAllPanels(): void {
    console.log('[PanelManager] Closing all panels')
    const panelTypes: PanelType[] = ['chat', 'notebook', 'browser', 'transcription']
    for (const panelType of panelTypes) {
      this.closePanelWindow(panelType)
    }
    // Clear hidden panel tracking
    this.hiddenPanelWindows = {
      chat: new Set(),
      notebook: new Set(),
      browser: new Set()
    }
  }

  /** Hide visible chat/notebook/browser panels without destroying them. */
  hideAllVisiblePanels(): void {
    const panelTypes: Array<'chat' | 'notebook' | 'browser'> = ['chat', 'notebook', 'browser']
    for (const panelType of panelTypes) {
      const windows = this.getAllPanelWindows(panelType)
      const hiddenSet = this.hiddenPanelWindows[panelType]
      for (const win of windows) {
        if (!win.isDestroyed() && win.isVisible()) {
          hiddenSet.add(win.id)
          win.hide()
        }
      }
      this.markPanelOpenState(panelType, false)
      this.broadcastPanelVisibility(panelType, false)
    }
    this.maybeYieldFocusAfterPanelsHidden()
  }

  // Get panel positions for external access
  getPanelPositions(): PanelPositions {
    return { ...this.panelPositions }
  }

  getPanelSizes(): PanelSizes {
    return { ...this.panelSizes }
  }

  // Close/destroy a specific panel window (from traffic light button)
  // This destroys the window completely so a new one will be created on next hotkey press
  destroyPanelWindow(windowId: number): void {
    const win = BrowserWindow.fromId(windowId)
    if (win && !win.isDestroyed()) {
      // For browser panels, we need to bypass the close prevention
      // by setting a flag or using destroy() directly
      this.destroyingPanelWindows.add(windowId)
      win.destroy()
      console.log(`[Panel] Destroyed window ${windowId}`)
    }
  }

  // Hide a specific panel window (minimize - from traffic light button)
  // This hides the window so it can be shown again via hotkey
  hidePanelWindow(
    windowId: number,
    panelType: 'chat' | 'notebook' | 'browser' | 'transcription'
  ): void {
    const win = BrowserWindow.fromId(windowId)
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.hide()
      if (panelType === 'chat' || panelType === 'notebook' || panelType === 'browser') {
        this.hiddenPanelWindows[panelType].add(windowId)
        const stillVisible = this.isPanelTypeVisible(panelType)
        this.markPanelOpenState(panelType, stillVisible)
      }
      console.log(`[Panel] Hidden window ${windowId}`)

      // Notify all windows about visibility change
      const isVisible =
        panelType === 'transcription'
          ? false
          : this.isPanelTypeVisible(panelType as 'chat' | 'notebook' | 'browser')
      if (panelType === 'chat' || panelType === 'notebook' || panelType === 'browser') {
        this.broadcastPanelVisibility(panelType, isVisible)
        this.maybeYieldFocusAfterPanelsHidden()
      } else {
        BrowserWindow.getAllWindows().forEach((w) => {
          if (w.isDestroyed() || w.webContents.isDestroyed()) return
          w.webContents.send('panel:visibility-changed', panelType, isVisible)
        })
      }
    }
  }

  // Store original bounds before maximizing (keyed by windowId)
  private originalBounds: Map<number, Electron.Rectangle> = new Map()

  // Maximize a panel window to almost fill the screen (with padding)
  // Not fullscreen - shows padding on all sides to make it clear it's not fullscreen
  // Returns whether the window is now maximized
  maximizePanelWindow(windowId: number): { isMaximized: boolean } {
    const win = BrowserWindow.fromId(windowId)
    if (win && !win.isDestroyed()) {
      // If already maximized, restore to original bounds
      if (this.originalBounds.has(windowId)) {
        const original = this.originalBounds.get(windowId)!
        win.setBounds(original)
        this.originalBounds.delete(windowId)
        console.log(`[Panel] Restored window ${windowId} to original size`)
        return { isMaximized: false }
      }

      // Store current bounds before maximizing
      this.originalBounds.set(windowId, win.getBounds())

      const display = screen.getDisplayMatching(win.getBounds())
      const workArea = display.workArea
      const padding = 40 // Padding on all sides

      const newBounds = {
        x: workArea.x + padding,
        y: workArea.y + padding,
        width: workArea.width - padding * 2,
        height: workArea.height - padding * 2
      }

      win.setBounds(newBounds)
      console.log(`[Panel] Maximized window ${windowId} with padding`)
      return { isMaximized: true }
    }
    return { isMaximized: false }
  }

  // Check if a panel window is currently maximized
  isPanelMaximized(windowId: number): boolean {
    return this.originalBounds.has(windowId)
  }

  // Get window ID for a specific panel type (finds the first visible or any window of that type)
  getWindowIdForPanel(panelType: 'chat' | 'notebook' | 'browser' | 'transcription'): number | null {
    const allBrowserWindows = BrowserWindow.getAllWindows()
    for (const win of allBrowserWindows) {
      if (!win.isDestroyed()) {
        try {
          const url = win.webContents.getURL()
          if (url.includes(`window=${panelType}`)) {
            return win.id
          }
        } catch {
          // Window might be in process of being destroyed
        }
      }
    }
    return null
  }
}

export const panelManager = new PanelManager()
