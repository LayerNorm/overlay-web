import { BrowserWindow, WebContentsView, session, DownloadItem, shell, clipboard, Menu, MenuItem, screen } from 'electron'
import { ipcMain } from './security/secure-ipc-main'
import { extname, join } from 'path'
import { app } from 'electron'
import * as fs from 'fs'
import { randomUUID } from 'node:crypto'
import {
  isSupportedBrowserPermission,
  MAX_BROWSER_DOWNLOAD_BYTES,
  normalizeBrowserPermissionOrigin,
  normalizeInteractiveBrowserUrl,
  sanitizeBrowserDownloadFilename
} from './security/browser-security-policy'

const DEFAULT_URL = 'https://www.google.com'
const BROWSER_PARTITION = 'persist:overlay-browser'
const BASE_TOOLBAR_HEIGHT = 81
const PERMISSION_REQUEST_TIMEOUT_MS = 60_000
const PERMISSION_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const PERMISSION_DENIAL_TTL_MS = 24 * 60 * 60 * 1000

type PendingPermissionRequest = {
  callback: (granted: boolean) => void
  origin: string
  permission: string
  rendererWebContentsId: number
  timeout: ReturnType<typeof setTimeout>
}

type SavedPermissionDecision = {
  granted: boolean
  expiresAt: number
}

export interface BrowserTab {
  id: string
  webContentsId: number
  url: string
  title: string
  favicon?: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  visitTime: number
  favicon?: string
}

export interface DownloadInfo {
  id: string
  url: string
  filename: string
  savePath: string
  receivedBytes: number
  totalBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
  isPaused: boolean
}

export interface PermissionRequest {
  id: string
  permission: string
  origin: string
  requestingUrl: string
}

export interface ContextMenuParams {
  x: number
  y: number
  linkURL?: string
  linkText?: string
  srcURL?: string
  mediaType?: string
  hasImageContents?: boolean
  selectionText?: string
  isEditable?: boolean
  editFlags?: {
    canUndo: boolean
    canRedo: boolean
    canCut: boolean
    canCopy: boolean
    canPaste: boolean
    canDelete: boolean
    canSelectAll: boolean
  }
  pageURL?: string
}

interface ClosedTab {
  url: string
  title: string
  windowId: number
}

class BrowserManager {
  private browserWindows: Map<number, BrowserWindow> = new Map()
  private tabs: Map<string, { view: WebContentsView; windowId: number }> = new Map()
  private activeTabByWindow: Map<number, string> = new Map()
  private windowZoomFactors: Map<number, number> = new Map()
  private windowSidePanelWidths: Map<number, number> = new Map()
  private windowLeftPanelWidths: Map<number, number> = new Map()
  private windowBottomBarHeights: Map<number, number> = new Map()
  private windowTopBarHeights: Map<number, number> = new Map()
  private windowClickThroughEnabled: Map<number, boolean> = new Map()
  private windowCloseOnLastTab: Map<number, boolean> = new Map()
  private history: HistoryEntry[] = []
  private downloads: Map<string, { item: DownloadItem; info: DownloadInfo }> = new Map()
  private historyPath: string = ''
  private downloadsPath: string = ''
  private initialized: boolean = false
  private permissionCallbacks = new Map<string, PendingPermissionRequest>()
  private savedPermissions: Map<string, Map<string, SavedPermissionDecision>> = new Map()
  private permissionsPath: string = ''
  private closedTabsStack: Map<number, ClosedTab[]> = new Map() // Stack of closed tabs per window
  private windowPanelBounds: Map<
    number,
    { x: number; y: number; width: number; height: number; borderRadius: number }
  > = new Map() // DockablePanel bounds within fullscreen window
  // Cursor polling for browser panel click-through management
  private cursorPollInterval: ReturnType<typeof setInterval> | null = null
  private windowClickThrough: Map<number, boolean> = new Map() // true = click-through enabled

  initialize(): void {
    if (this.initialized) return
    this.initialized = true
    const userDataPath = app.getPath('userData')
    this.historyPath = join(userDataPath, 'browser-history.json')
    this.downloadsPath = join(userDataPath, 'Downloads')
    this.permissionsPath = join(userDataPath, 'browser-permissions.json')
    this.loadHistory()
    this.loadPermissions()
    this.setupDownloadHandler()
    this.setupPermissionHandler()
  }

  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyPath)) {
        const data = fs.readFileSync(this.historyPath, 'utf-8')
        this.history = JSON.parse(data)
      }
    } catch (error) {
      console.error('[BrowserManager] Failed to load history:', error)
      this.history = []
    }
  }

  private saveHistory(): void {
    try {
      fs.writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2))
    } catch (error) {
      console.error('[BrowserManager] Failed to save history:', error)
    }
  }

  private loadPermissions(): void {
    try {
      if (fs.existsSync(this.permissionsPath)) {
        const data = fs.readFileSync(this.permissionsPath, 'utf-8')
        const parsed: unknown = JSON.parse(data)
        this.savedPermissions = new Map()
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
        for (const [origin, permissions] of Object.entries(parsed)) {
          if (
            normalizeBrowserPermissionOrigin(origin) !== origin ||
            !permissions ||
            typeof permissions !== 'object' ||
            Array.isArray(permissions)
          ) {
            continue
          }
          const validated = new Map<string, SavedPermissionDecision>()
          for (const [permission, decision] of Object.entries(permissions)) {
            if (
              isSupportedBrowserPermission(permission) &&
              decision &&
              typeof decision === 'object' &&
              !Array.isArray(decision) &&
              typeof (decision as { granted?: unknown }).granted === 'boolean' &&
              typeof (decision as { expiresAt?: unknown }).expiresAt === 'number' &&
              (decision as { expiresAt: number }).expiresAt > Date.now()
            ) {
              validated.set(permission, decision as SavedPermissionDecision)
            }
          }
          if (validated.size > 0) this.savedPermissions.set(origin, validated)
        }
      }
    } catch (error) {
      console.error('[BrowserManager] Failed to load permissions:', error)
      this.savedPermissions = new Map()
    }
  }

  private savePermissions(): void {
    try {
      // Convert nested Map to plain object for JSON serialization
      const obj: Record<string, Record<string, SavedPermissionDecision>> = {}
      for (const [origin, permissions] of this.savedPermissions.entries()) {
        obj[origin] = Object.fromEntries(permissions)
      }
      fs.writeFileSync(this.permissionsPath, JSON.stringify(obj, null, 2), { mode: 0o600 })
    } catch (error) {
      console.error('[BrowserManager] Failed to save permissions:', error)
    }
  }

  private addToHistory(url: string, title: string, favicon?: string): void {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      url,
      title,
      visitTime: Date.now(),
      favicon
    }
    this.history.unshift(entry)
    // Keep last 1000 entries
    if (this.history.length > 1000) {
      this.history = this.history.slice(0, 1000)
    }
    this.saveHistory()
  }

  private setupDownloadHandler(): void {
    const browserSession = session.fromPartition(BROWSER_PARTITION)

    browserSession.on('will-download', (_event, item, webContents) => {
      const downloadId = randomUUID()
      const filename = sanitizeBrowserDownloadFilename(item.getFilename())

      // Ensure downloads directory exists
      if (!fs.existsSync(this.downloadsPath)) {
        fs.mkdirSync(this.downloadsPath, { recursive: true, mode: 0o700 })
      }
      const savePath = this.nextAvailableDownloadPath(filename)
      const declaredBytes = item.getTotalBytes()
      if (declaredBytes > MAX_BROWSER_DOWNLOAD_BYTES) {
        item.cancel()
        return
      }

      item.setSavePath(savePath)

      const info: DownloadInfo = {
        id: downloadId,
        url: item.getURL(),
        filename,
        savePath,
        receivedBytes: 0,
        totalBytes: item.getTotalBytes(),
        state: 'progressing',
        startTime: Date.now(),
        isPaused: false
      }

      this.downloads.set(downloadId, { item, info })

      // Find the window that initiated this download
      const win = BrowserWindow.fromWebContents(webContents)
      if (win) {
        win.webContents.send('browser:download-started', info)
      }

      item.on('updated', (_event, state) => {
        const download = this.downloads.get(downloadId)
        if (download) {
          download.info.receivedBytes = item.getReceivedBytes()
          if (download.info.receivedBytes > MAX_BROWSER_DOWNLOAD_BYTES) {
            item.cancel()
          }
          download.info.totalBytes = item.getTotalBytes()
          download.info.state = state === 'interrupted' ? 'interrupted' : 'progressing'
          download.info.isPaused = item.isPaused()

          if (win && !win.isDestroyed()) {
            win.webContents.send('browser:download-updated', download.info)
          }
        }
      })

      item.once('done', (_event, state) => {
        const download = this.downloads.get(downloadId)
        if (download) {
          download.info.state = state as DownloadInfo['state']
          download.info.receivedBytes = item.getReceivedBytes()
          if (state !== 'completed') {
            try {
              fs.unlinkSync(download.info.savePath)
            } catch {
              // Chromium may already have removed the partial file.
            }
          }

          if (win && !win.isDestroyed()) {
            win.webContents.send('browser:download-completed', download.info)
          }
        }
      })
    })
  }

  private nextAvailableDownloadPath(filename: string): string {
    const extension = extname(filename)
    const stem = filename.slice(0, Math.max(0, filename.length - extension.length)) || 'download'
    for (let index = 0; index < 10_000; index += 1) {
      const candidateName = index === 0 ? filename : `${stem}-${index}${extension}`
      const candidate = join(this.downloadsPath, candidateName)
      if (!fs.existsSync(candidate)) return candidate
    }
    return join(this.downloadsPath, `${stem}-${randomUUID()}${extension}`)
  }

  registerWindow(
    win: BrowserWindow,
    options: {
      createInitialTab?: boolean
      enableClickThrough?: boolean
      closeWindowOnLastTab?: boolean
    } = {}
  ): void {
    this.initialize()
    const windowId = win.id
    const alreadyRegistered = this.browserWindows.has(windowId)
    const enableClickThrough = options.enableClickThrough ?? true

    if (alreadyRegistered) {
      // Preserve the click-through mode from the first registration. The dockable
      // browser panel is registered with click-through polling by panel-manager
      // before the renderer's ensureWindow() runs — re-registering here must not
      // downgrade it to an always-interactive window, or cursor polling stops
      // managing it and the panel gets stuck click-through.
      this.windowCloseOnLastTab.set(windowId, options.closeWindowOnLastTab ?? true)
      if (options.createInitialTab) {
        const hasTabs = Array.from(this.tabs.values()).some((tab) => tab.windowId === windowId)
        if (!hasTabs) this.createTab(windowId, DEFAULT_URL)
      }
      return
    }

    this.browserWindows.set(windowId, win)
    this.windowZoomFactors.set(windowId, 1)
    this.windowSidePanelWidths.set(windowId, 0)
    this.windowLeftPanelWidths.set(windowId, 0)
    this.windowClickThroughEnabled.set(windowId, enableClickThrough)
    this.windowClickThrough.set(windowId, enableClickThrough)
    this.windowCloseOnLastTab.set(windowId, options.closeWindowOnLastTab ?? true)

    if (!enableClickThrough) {
      win.setIgnoreMouseEvents(false)
    }

    win.on('resize', () => {
      this.updateTabBounds(windowId)
    })

    win.on('closed', () => {
      // Clean up tabs for this window
      for (const [tabId, tabData] of this.tabs.entries()) {
        if (tabData.windowId === windowId) {
          this.tabs.delete(tabId)
        }
      }
      this.activeTabByWindow.delete(windowId)
      this.browserWindows.delete(windowId)
      this.windowZoomFactors.delete(windowId)
      this.windowSidePanelWidths.delete(windowId)
      this.windowLeftPanelWidths.delete(windowId)
      this.windowPanelBounds.delete(windowId)
      this.windowClickThrough.delete(windowId)
      this.windowClickThroughEnabled.delete(windowId)
      this.windowCloseOnLastTab.delete(windowId)
      if (!this.hasClickThroughWindows()) {
        this.stopCursorPolling()
      }
    })

    if (options.createInitialTab !== false) {
      this.createTab(windowId, DEFAULT_URL)
    }
  }

  createTab(windowId: number, url: string = DEFAULT_URL): BrowserTab | null {
    const win = this.browserWindows.get(windowId)
    if (!win) {
      console.error('[BrowserManager] Window not found:', windowId)
      return null
    }

    const initialUrl = normalizeInteractiveBrowserUrl(url) ?? DEFAULT_URL
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    // Add view to window
    win.contentView.addChildView(view)

    // Store tab data
    this.tabs.set(tabId, { view, windowId })

    this.updateTabBounds(windowId)

    // Set as active tab
    this.activeTabByWindow.set(windowId, tabId)

    // Setup webContents event handlers
    const webContents = view.webContents

    webContents.on('did-start-loading', () => {
      this.sendTabUpdate(windowId, tabId, { isLoading: true })
    })

    webContents.on('did-stop-loading', () => {
      this.sendTabUpdate(windowId, tabId, {
        isLoading: false,
        canGoBack: webContents.navigationHistory.canGoBack(),
        canGoForward: webContents.navigationHistory.canGoForward()
      })
    })

    webContents.on('did-navigate', (_event, navUrl) => {
      const title = webContents.getTitle() || navUrl
      this.sendTabUpdate(windowId, tabId, {
        url: navUrl,
        title,
        canGoBack: webContents.navigationHistory.canGoBack(),
        canGoForward: webContents.navigationHistory.canGoForward()
      })
      this.addToHistory(navUrl, title)
    })

    webContents.on('did-navigate-in-page', (_event, navUrl, isMainFrame) => {
      if (isMainFrame) {
        const title = webContents.getTitle() || navUrl
        this.sendTabUpdate(windowId, tabId, {
          url: navUrl,
          title,
          canGoBack: webContents.navigationHistory.canGoBack(),
          canGoForward: webContents.navigationHistory.canGoForward()
        })
      }
    })

    webContents.on('page-title-updated', (_event, title) => {
      this.sendTabUpdate(windowId, tabId, { title })
    })

    webContents.on('page-favicon-updated', (_event, favicons) => {
      if (favicons.length > 0) {
        this.sendTabUpdate(windowId, tabId, { favicon: favicons[0] })
      }
    })

    // Handle new window requests - open in new tab instead
    webContents.setWindowOpenHandler(({ url }) => {
      const popupUrl = normalizeInteractiveBrowserUrl(url)
      if (popupUrl) this.createTab(windowId, popupUrl)
      return { action: 'deny' }
    })
    const preventUnsafeNavigation = (
      event: { preventDefault(): void },
      targetUrl: string
    ): void => {
      if (!normalizeInteractiveBrowserUrl(targetUrl)) event.preventDefault()
    }
    webContents.on('will-navigate', preventUnsafeNavigation)
    webContents.on('will-redirect', preventUnsafeNavigation)

    // Setup find-in-page handler
    this.setupFindInPageHandler(tabId, windowId)

    // Setup context menu handler
    this.setupContextMenuHandler(tabId, windowId)

    // Setup keyboard shortcut handler for webContents
    this.setupKeyboardShortcuts(tabId, windowId)

    // Load the URL
    void webContents.loadURL(initialUrl)

    const tab: BrowserTab = {
      id: tabId,
      webContentsId: webContents.id,
      url: initialUrl,
      title: 'New Tab',
      isLoading: true,
      canGoBack: false,
      canGoForward: false
    }

    // Notify renderer of new tab
    win.webContents.send('browser:tab-created', tab)

    return tab
  }

  private sendTabUpdate(windowId: number, tabId: string, changes: Partial<BrowserTab>): void {
    const win = this.browserWindows.get(windowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('browser:tab-updated', tabId, changes)
    }
  }

  closeTab(tabId: string): boolean {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return false

    const { view, windowId } = tabData
    const win = this.browserWindows.get(windowId)

    // Save tab info before closing for reopen functionality
    const url = view.webContents.getURL()
    const title = view.webContents.getTitle()
    if (url && url !== 'about:blank') {
      if (!this.closedTabsStack.has(windowId)) {
        this.closedTabsStack.set(windowId, [])
      }
      const stack = this.closedTabsStack.get(windowId)!
      stack.push({ url, title, windowId })
      // Keep only last 10 closed tabs
      if (stack.length > 10) {
        stack.shift()
      }
    }

    if (win && !win.isDestroyed()) {
      win.contentView.removeChildView(view)
      win.webContents.send('browser:tab-closed', tabId)
    }

    // Destroy the view's webContents
    view.webContents.close()
    this.tabs.delete(tabId)

    // If this was the active tab, switch to another
    if (this.activeTabByWindow.get(windowId) === tabId) {
      const remainingTabs = Array.from(this.tabs.entries()).filter(
        ([, data]) => data.windowId === windowId
      )

      if (remainingTabs.length > 0) {
        this.switchTab(remainingTabs[0][0])
      } else {
        this.activeTabByWindow.delete(windowId)
        // Only close the window if closeWindowOnLastTab is true (standalone panel).
        // For embedded browsers (main window), keep the window open so the renderer
        // can show an empty state with a "New Tab" and recently visited websites.
        if (this.windowCloseOnLastTab.get(windowId) !== false) {
          if (win && !win.isDestroyed()) {
            win.close()
          }
        }
      }
    }

    return true
  }

  switchTab(tabId: string): boolean {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return false

    const { view, windowId } = tabData
    const win = this.browserWindows.get(windowId)
    if (!win || win.isDestroyed()) return false

    // Hide all other tabs for this window
    for (const [otherTabId, otherData] of this.tabs.entries()) {
      if (otherData.windowId === windowId && otherTabId !== tabId) {
        otherData.view.setVisible(false)
      }
    }

    // Show this tab
    view.setVisible(true)
    this.activeTabByWindow.set(windowId, tabId)

    // Notify renderer
    win.webContents.send('browser:tab-activated', tabId)

    return true
  }

  navigate(tabId: string, url: string): boolean {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return false

    let targetUrl = url.trim()
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
        targetUrl = 'https://' + targetUrl
      } else {
        targetUrl = `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`
      }
    }

    const normalized = normalizeInteractiveBrowserUrl(targetUrl)
    if (!normalized) return false
    void tabData.view.webContents.loadURL(normalized)
    return true
  }

  goBack(tabId: string): boolean {
    const tabData = this.tabs.get(tabId)
    if (!tabData || !tabData.view.webContents.navigationHistory.canGoBack()) return false
    tabData.view.webContents.goBack()
    return true
  }

  goForward(tabId: string): boolean {
    const tabData = this.tabs.get(tabId)
    if (!tabData || !tabData.view.webContents.navigationHistory.canGoForward()) return false
    tabData.view.webContents.goForward()
    return true
  }

  reload(tabId: string): boolean {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return false
    tabData.view.webContents.reload()
    return true
  }

  stop(tabId: string): boolean {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return false
    tabData.view.webContents.stop()
    return true
  }

  hardReload(tabId: string): boolean {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return false
    tabData.view.webContents.reloadIgnoringCache()
    return true
  }

  // Hide all tabs for a window (used when showing settings)
  hideAllTabs(windowId: number): void {
    for (const [, tabData] of this.tabs.entries()) {
      if (tabData.windowId === windowId) {
        tabData.view.setVisible(false)
      }
    }
  }

  // Show the active tab for a window (used when hiding settings)
  showActiveTab(windowId: number): void {
    const activeTabId = this.activeTabByWindow.get(windowId)
    if (activeTabId) {
      const tabData = this.tabs.get(activeTabId)
      if (tabData) {
        tabData.view.setVisible(true)
      }
    }
  }

  // Close all tabs and the browser panel
  closeAllTabs(windowId: number): void {
    const tabIds = Array.from(this.tabs.entries())
      .filter(([, data]) => data.windowId === windowId)
      .map(([id]) => id)

    for (const tabId of tabIds) {
      const tabData = this.tabs.get(tabId)
      if (tabData) {
        const win = this.browserWindows.get(windowId)
        if (win && !win.isDestroyed()) {
          win.contentView.removeChildView(tabData.view)
        }
        tabData.view.webContents.close()
        this.tabs.delete(tabId)
      }
    }

    this.activeTabByWindow.delete(windowId)
    this.closedTabsStack.delete(windowId)
  }

  // Close current tab, but if it's the last one, open a new default tab instead
  closeTabOrOpenNew(tabId: string): { closed: boolean; newTabId?: string } {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return { closed: false }

    const { windowId } = tabData
    const tabCount = this.getTabCount(windowId)

    if (tabCount === 1) {
      // Last tab - create new one first, then close the old one
      const newTab = this.createTab(windowId, 'https://www.google.com')
      if (newTab) {
        this.closeTab(tabId)
        return { closed: true, newTabId: newTab.id }
      }
      return { closed: false }
    } else {
      // Not the last tab - just close it normally
      this.closeTab(tabId)
      return { closed: true }
    }
  }

  reopenClosedTab(windowId: number): BrowserTab | null {
    const stack = this.closedTabsStack.get(windowId)
    if (!stack || stack.length === 0) return null

    const closedTab = stack.pop()!
    return this.createTab(windowId, closedTab.url)
  }

  getTabByIndex(windowId: number, index: number): string | null {
    const windowTabs = Array.from(this.tabs.entries()).filter(
      ([, data]) => data.windowId === windowId
    )

    if (index < 0 || index >= windowTabs.length) return null
    return windowTabs[index][0]
  }

  getTabCount(windowId: number): number {
    return Array.from(this.tabs.entries()).filter(([, data]) => data.windowId === windowId).length
  }

  getNextTab(windowId: number): string | null {
    const windowTabs = Array.from(this.tabs.entries()).filter(
      ([, data]) => data.windowId === windowId
    )

    if (windowTabs.length <= 1) return null

    const activeTabId = this.activeTabByWindow.get(windowId)
    const currentIndex = windowTabs.findIndex(([id]) => id === activeTabId)
    const nextIndex = (currentIndex + 1) % windowTabs.length
    return windowTabs[nextIndex][0]
  }

  getPreviousTab(windowId: number): string | null {
    const windowTabs = Array.from(this.tabs.entries()).filter(
      ([, data]) => data.windowId === windowId
    )

    if (windowTabs.length <= 1) return null

    const activeTabId = this.activeTabByWindow.get(windowId)
    const currentIndex = windowTabs.findIndex(([id]) => id === activeTabId)
    const prevIndex = currentIndex <= 0 ? windowTabs.length - 1 : currentIndex - 1
    return windowTabs[prevIndex][0]
  }

  getTabInfo(tabId: string): BrowserTab | null {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return null

    const wc = tabData.view.webContents
    return {
      id: tabId,
      webContentsId: wc.id,
      url: wc.getURL(),
      title: wc.getTitle() || 'New Tab',
      isLoading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward()
    }
  }

  getTabsForWindow(windowId: number): BrowserTab[] {
    const tabs: BrowserTab[] = []
    for (const [tabId, tabData] of this.tabs.entries()) {
      if (tabData.windowId === windowId) {
        const info = this.getTabInfo(tabId)
        if (info) tabs.push(info)
      }
    }
    return tabs
  }

  getActiveTabId(windowId: number): string | null {
    return this.activeTabByWindow.get(windowId) || null
  }

  getHistory(): HistoryEntry[] {
    return this.history
  }

  clearHistory(): void {
    this.history = []
    this.saveHistory()
  }

  deleteHistoryEntry(id: string): void {
    this.history = this.history.filter((entry) => entry.id !== id)
    this.saveHistory()
  }

  getDownloads(): DownloadInfo[] {
    return Array.from(this.downloads.values()).map((d) => d.info)
  }

  pauseDownload(downloadId: string): boolean {
    const download = this.downloads.get(downloadId)
    if (!download || download.info.state !== 'progressing') return false
    download.item.pause()
    return true
  }

  resumeDownload(downloadId: string): boolean {
    const download = this.downloads.get(downloadId)
    if (!download || !download.item.isPaused()) return false
    download.item.resume()
    return true
  }

  cancelDownload(downloadId: string): boolean {
    const download = this.downloads.get(downloadId)
    if (!download) return false
    download.item.cancel()
    return true
  }

  openDownloadsFolder(): void {
    if (!fs.existsSync(this.downloadsPath)) {
      fs.mkdirSync(this.downloadsPath, { recursive: true })
    }
    shell.openPath(this.downloadsPath)
  }

  setPanelBounds(
    windowId: number,
    bounds: { x: number; y: number; width: number; height: number; borderRadius: number }
  ): void {
    // Store bounds even if the window isn't registered yet — the renderer can
    // report bounds before ensureWindow() completes; they're applied on tab creation
    this.windowPanelBounds.set(windowId, bounds)
    if (!this.browserWindows.has(windowId)) return
    this.updateTabBounds(windowId)
    if (this.windowClickThroughEnabled.get(windowId) ?? true) {
      this.ensureCursorPolling()
    }
  }

  private hasClickThroughWindows(): boolean {
    return Array.from(this.browserWindows.keys()).some(
      (windowId) => this.windowClickThroughEnabled.get(windowId) ?? true
    )
  }

  private getInteractiveBounds(
    windowId: number,
    win: BrowserWindow
  ): { x: number; y: number; width: number; height: number } {
    const panelBounds = this.windowPanelBounds.get(windowId)
    const contentBounds = win.getContentBounds()
    const baseX = panelBounds ? panelBounds.x : 0
    const baseY = panelBounds ? panelBounds.y : 0
    const baseW = panelBounds ? panelBounds.width : contentBounds.width
    const baseH = panelBounds ? panelBounds.height : contentBounds.height
    const frameInset = panelBounds ? 8 : 0

    const zoomFactor = this.windowZoomFactors.get(windowId) ?? 1
    const sidePanelWidth = this.windowSidePanelWidths.get(windowId) ?? 0
    const leftPanelWidth = this.windowLeftPanelWidths.get(windowId) ?? 0
    const bottomBarHeight = this.windowBottomBarHeights.get(windowId) ?? 0
    const topBarHeight = this.windowTopBarHeights.get(windowId) ?? 0
    const toolbarHeight = Math.round(BASE_TOOLBAR_HEIGHT * zoomFactor)
    const adjustedSidePanelWidth = Math.round(sidePanelWidth * zoomFactor)
    const adjustedLeftPanelWidth = Math.round(leftPanelWidth * zoomFactor)
    const adjustedBottomBarHeight = Math.round(bottomBarHeight * zoomFactor)
    const adjustedTopBarHeight = Math.round(topBarHeight * zoomFactor)

    return {
      x: baseX + adjustedLeftPanelWidth + frameInset,
      y: baseY + toolbarHeight + adjustedTopBarHeight + frameInset,
      width: Math.max(
        0,
        baseW - adjustedSidePanelWidth - adjustedLeftPanelWidth - frameInset * 2
      ),
      height: Math.max(
        0,
        baseH - toolbarHeight - adjustedBottomBarHeight - adjustedTopBarHeight - frameInset * 2
      )
    }
  }

  // Start cursor polling for browser panel click-through management.
  // Polls cursor position every 50ms and toggles setIgnoreMouseEvents
  // based on whether cursor is within any browser panel's bounds.
  private ensureCursorPolling(): void {
    if (this.cursorPollInterval) return
    this.cursorPollInterval = setInterval(() => {
      const cursorPoint = screen.getCursorScreenPoint()

      const entries = Array.from(this.browserWindows.entries())
      for (const [windowId, win] of entries) {
        if (win.isDestroyed() || !win.isVisible()) continue
        if (!(this.windowClickThroughEnabled.get(windowId) ?? true)) continue

        const interactiveBounds = this.getInteractiveBounds(windowId, win)
        const winBounds = win.getBounds()
        const screenX = winBounds.x + interactiveBounds.x
        const screenY = winBounds.y + interactiveBounds.y
        const screenRight = screenX + interactiveBounds.width
        const screenBottom = screenY + interactiveBounds.height

        const isInside =
          cursorPoint.x >= screenX &&
          cursorPoint.x <= screenRight &&
          cursorPoint.y >= screenY &&
          cursorPoint.y <= screenBottom

        // Forward hover state to renderer so BrowserPanel can react
        // even when cursor is over the native WebContentsView
        if (!win.isDestroyed()) {
          win.webContents.send('browser:cursor-in-panel', isInside)
        }

        const wasClickThrough = this.windowClickThrough.get(windowId) ?? true

        if (isInside && wasClickThrough) {
          // Cursor entered panel bounds — make interactive
          win.setIgnoreMouseEvents(false)
          this.windowClickThrough.set(windowId, false)
        } else if (!isInside && !wasClickThrough) {
          // Cursor left panel bounds — restore click-through
          win.setIgnoreMouseEvents(true, { forward: true })
          this.windowClickThrough.set(windowId, true)
        }
      }

      // Stop polling if no browser windows remain
      if (!this.hasClickThroughWindows()) {
        this.stopCursorPolling()
      }
    }, 50)
  }

  private stopCursorPolling(): void {
    if (this.cursorPollInterval) {
      clearInterval(this.cursorPollInterval)
      this.cursorPollInterval = null
    }
  }

  private updateTabBounds(windowId: number): void {
    const win = this.browserWindows.get(windowId)
    if (!win || win.isDestroyed()) return

    // Use DockablePanel bounds if available (fullscreen transparent window),
    // otherwise fall back to window content bounds (legacy non-dockable)
    const { x: xOffset, y: yOffset, width, height } = this.getInteractiveBounds(windowId, win)

    for (const [, tabData] of this.tabs.entries()) {
      if (tabData.windowId === windowId) {
        tabData.view.setBounds({
          x: xOffset,
          y: yOffset,
          width,
          height
        })
        // Rounded corners on WebContentsView — the FRAME_INSET gap between the
        // rounded native view and the rectangular shell creates the frame effect:
        // rounded inside (matching web content) / sharp outside (matching shell)
        tabData.view.setBorderRadius(8)
      }
    }
  }

  setWindowZoomFactor(windowId: number, zoomFactor: number): void {
    if (!this.browserWindows.has(windowId)) return
    const clampedZoom = Math.max(0.5, Math.min(2.5, zoomFactor))
    this.windowZoomFactors.set(windowId, clampedZoom)
    this.updateTabBounds(windowId)
  }

  setSidePanelWidth(windowId: number, sidePanelWidth: number): void {
    if (!this.browserWindows.has(windowId)) return
    this.windowSidePanelWidths.set(windowId, sidePanelWidth)
    this.updateTabBounds(windowId)
  }

  setLeftPanelWidth(windowId: number, leftPanelWidth: number): void {
    if (!this.browserWindows.has(windowId)) return
    this.windowLeftPanelWidths.set(windowId, leftPanelWidth)
    this.updateTabBounds(windowId)
  }

  setBottomBarHeight(windowId: number, bottomBarHeight: number): void {
    this.windowBottomBarHeights.set(windowId, bottomBarHeight)
    if (!this.browserWindows.has(windowId)) return
    this.updateTabBounds(windowId)
  }

  setTopBarHeight(windowId: number, topBarHeight: number): void {
    this.windowTopBarHeights.set(windowId, topBarHeight)
    if (!this.browserWindows.has(windowId)) return
    this.updateTabBounds(windowId)
  }

  // Find in page methods
  findInPage(
    tabId: string,
    text: string,
    options: { forward?: boolean; findNext?: boolean } = {}
  ): boolean {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return false

    tabData.view.webContents.findInPage(text, {
      forward: options.forward ?? true,
      findNext: options.findNext ?? false
    })
    return true
  }

  stopFindInPage(
    tabId: string,
    action: 'clearSelection' | 'keepSelection' | 'activateSelection' = 'clearSelection'
  ): boolean {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return false

    tabData.view.webContents.stopFindInPage(action)
    return true
  }

  setupFindInPageHandler(tabId: string, windowId: number): void {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return

    const win = this.browserWindows.get(windowId)
    if (!win) return

    tabData.view.webContents.on('found-in-page', (_event, result) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('browser:found-in-page', {
          activeMatchOrdinal: result.activeMatchOrdinal,
          matches: result.matches
        })
      }
    })
  }

  // Keyboard shortcuts handler for webContents - intercepts shortcuts even when webContents is focused
  setupKeyboardShortcuts(tabId: string, windowId: number): void {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return

    const win = this.browserWindows.get(windowId)
    if (!win) return

    // Helper to send shortcut and refocus the active tab's webContents
    const sendShortcut = (shortcut: string, data?: number): void => {
      win.webContents.send('browser:shortcut', shortcut, data)
      // Refocus the active tab's webContents after a short delay to ensure the shortcut is processed
      setTimeout(() => {
        const activeTabId = this.activeTabByWindow.get(windowId)
        if (activeTabId) {
          const activeTabData = this.tabs.get(activeTabId)
          if (activeTabData && !activeTabData.view.webContents.isDestroyed()) {
            activeTabData.view.webContents.focus()
          }
        }
      }, 50)
    }

    tabData.view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return

      const isMeta = input.meta || input.control

      // Cmd+T - New tab
      if (isMeta && input.key === 't') {
        event.preventDefault()
        sendShortcut('new-tab')
        return
      }

      // Cmd+W - Close tab (but keep one open)
      if (isMeta && !input.shift && input.key === 'w') {
        event.preventDefault()
        sendShortcut('close-tab')
        return
      }

      // Cmd+Shift+W - Close all tabs and panel
      if (isMeta && input.shift && input.key.toLowerCase() === 'w') {
        event.preventDefault()
        sendShortcut('close-all')
        return
      }

      // Cmd+Shift+T - Reopen closed tab
      if (isMeta && input.shift && input.key === 'T') {
        event.preventDefault()
        sendShortcut('reopen-tab')
        return
      }

      // Cmd+L - Focus omnibox
      if (isMeta && input.key === 'l') {
        event.preventDefault()
        sendShortcut('focus-omnibox')
        return
      }

      // Cmd+R - Reload
      if (isMeta && !input.shift && input.key === 'r') {
        event.preventDefault()
        sendShortcut('reload')
        return
      }

      // Cmd+Shift+R - Hard reload
      if (isMeta && input.shift && input.key === 'R') {
        event.preventDefault()
        sendShortcut('hard-reload')
        return
      }

      // Cmd+F - Find in page
      if (isMeta && input.key === 'f') {
        event.preventDefault()
        sendShortcut('find')
        return
      }

      // Cmd+[ - Go back
      if (isMeta && input.key === '[') {
        event.preventDefault()
        sendShortcut('go-back')
        return
      }

      // Cmd+] - Go forward
      if (isMeta && input.key === ']') {
        event.preventDefault()
        sendShortcut('go-forward')
        return
      }

      // Cmd+Shift+[ - Previous tab
      if (isMeta && input.shift && input.key === '{') {
        event.preventDefault()
        sendShortcut('prev-tab')
        return
      }

      // Cmd+Shift+] - Next tab
      if (isMeta && input.shift && input.key === '}') {
        event.preventDefault()
        sendShortcut('next-tab')
        return
      }

      // Cmd+1-9 - Switch to tab
      if (isMeta && /^[1-9]$/.test(input.key)) {
        event.preventDefault()
        sendShortcut('switch-tab', parseInt(input.key))
        return
      }

      // Cmd+Shift+/ - Settings
      if (isMeta && input.shift && input.key === '?') {
        event.preventDefault()
        sendShortcut('settings')
        return
      }

      // Escape - Stop/cancel
      if (input.key === 'Escape') {
        event.preventDefault()
        sendShortcut('escape')
        return
      }
    })
  }

  // Permission handling
  setupPermissionHandler(): void {
    const browserSession = session.fromPartition(BROWSER_PARTITION)

    browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const url = details.requestingUrl || webContents.getURL()
      const origin = normalizeBrowserPermissionOrigin(url)
      if (!origin || details.isMainFrame !== true || !isSupportedBrowserPermission(permission)) {
        callback(false)
        return
      }

      // Check if we have a saved permission decision
      const savedDecision = this.getSavedPermissionDecision(origin, permission)
      if (savedDecision) {
        callback(savedDecision.granted)
        return
      }

      // Send permission request to renderer
      const requestId = randomUUID()
      const win = BrowserWindow.fromWebContents(webContents)

      if (win) {
        const request: PermissionRequest = {
          id: requestId,
          permission,
          origin,
          requestingUrl: url
        }

        const timeout = setTimeout(() => {
          const pending = this.permissionCallbacks.get(requestId)
          if (!pending) return
          this.permissionCallbacks.delete(requestId)
          pending.callback(false)
        }, PERMISSION_REQUEST_TIMEOUT_MS)
        this.permissionCallbacks.set(requestId, {
          callback,
          origin,
          permission,
          rendererWebContentsId: win.webContents.id,
          timeout
        })

        win.webContents.send('browser:permission-request', request)
      } else {
        // No window found, deny by default
        callback(false)
      }
    })

    browserSession.setPermissionCheckHandler(
      (_webContents, permission, requestingOrigin, details) => {
        const origin = normalizeBrowserPermissionOrigin(requestingOrigin)
        if (
          !origin ||
          details.isMainFrame !== true ||
          details.embeddingOrigin ||
          !isSupportedBrowserPermission(permission)
        ) {
          return false
        }
        return this.getSavedPermissionDecision(origin, permission)?.granted === true
      }
    )
  }

  resolvePermission(
    requestId: string,
    granted: boolean,
    remember: boolean,
    rendererWebContentsId: number
  ): boolean {
    const pending = this.permissionCallbacks.get(requestId)
    if (!pending || pending.rendererWebContentsId !== rendererWebContentsId) return false

    this.permissionCallbacks.delete(requestId)
    clearTimeout(pending.timeout)
    const decision = granted === true
    if (remember === true) {
      this.savePermissionDecision(pending.origin, pending.permission, decision)
    }
    pending.callback(decision)

    return true
  }

  private savePermissionDecision(origin: string, permission: string, granted: boolean): void {
    if (!this.savedPermissions.has(origin)) {
      this.savedPermissions.set(origin, new Map())
    }
    this.savedPermissions.get(origin)!.set(permission, {
      granted,
      expiresAt: Date.now() + (granted ? PERMISSION_GRANT_TTL_MS : PERMISSION_DENIAL_TTL_MS)
    })
    this.savePermissions()
  }

  private getSavedPermissionDecision(
    origin: string,
    permission: string
  ): SavedPermissionDecision | null {
    const permissions = this.savedPermissions.get(origin)
    const decision = permissions?.get(permission)
    if (!decision) return null
    if (decision.expiresAt <= Date.now()) {
      permissions!.delete(permission)
      if (permissions!.size === 0) this.savedPermissions.delete(origin)
      this.savePermissions()
      return null
    }
    return decision
  }

  // Context menu handling - uses native Electron Menu
  setupContextMenuHandler(tabId: string, windowId: number): void {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return

    const win = this.browserWindows.get(windowId)
    if (!win) return

    tabData.view.webContents.on('context-menu', (_event, params) => {
      if (!win || win.isDestroyed()) return

      const wc = tabData.view.webContents
      const menu = new Menu()

      // Link context
      if (params.linkURL) {
        menu.append(
          new MenuItem({
            label: 'Open Link',
            click: () => {
              const target = normalizeInteractiveBrowserUrl(params.linkURL)
              if (target) void wc.loadURL(target)
            }
          })
        )
        menu.append(
          new MenuItem({
            label: 'Open Link in New Tab',
            click: () => this.createTab(windowId, params.linkURL)
          })
        )
        menu.append(
          new MenuItem({
            label: 'Copy Link',
            click: () => clipboard.writeText(params.linkURL)
          })
        )
        menu.append(new MenuItem({ type: 'separator' }))
      }

      // Image context
      if (params.hasImageContents && params.srcURL) {
        menu.append(
          new MenuItem({
            label: 'Open Image in New Tab',
            click: () => this.createTab(windowId, params.srcURL)
          })
        )
        menu.append(
          new MenuItem({
            label: 'Save Image',
            click: () => wc.downloadURL(params.srcURL)
          })
        )
        menu.append(
          new MenuItem({
            label: 'Copy Image',
            click: () => wc.copyImageAt(params.x, params.y)
          })
        )
        menu.append(
          new MenuItem({
            label: 'Copy Image URL',
            click: () => clipboard.writeText(params.srcURL)
          })
        )
        menu.append(new MenuItem({ type: 'separator' }))
      }

      // Selection context
      if (params.selectionText) {
        menu.append(
          new MenuItem({
            label: 'Copy',
            click: () => wc.copy()
          })
        )
        menu.append(
          new MenuItem({
            label: `Search Google for "${params.selectionText.substring(0, 20)}${params.selectionText.length > 20 ? '...' : ''}"`,
            click: () => {
              const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`
              this.createTab(windowId, searchUrl)
            }
          })
        )
        menu.append(new MenuItem({ type: 'separator' }))
      }

      // Editable context
      if (params.isEditable) {
        menu.append(
          new MenuItem({
            label: 'Undo',
            enabled: params.editFlags.canUndo,
            click: () => wc.undo()
          })
        )
        menu.append(
          new MenuItem({
            label: 'Redo',
            enabled: params.editFlags.canRedo,
            click: () => wc.redo()
          })
        )
        menu.append(new MenuItem({ type: 'separator' }))
        menu.append(
          new MenuItem({
            label: 'Cut',
            enabled: params.editFlags.canCut,
            click: () => wc.cut()
          })
        )
        menu.append(
          new MenuItem({
            label: 'Copy',
            enabled: params.editFlags.canCopy,
            click: () => wc.copy()
          })
        )
        menu.append(
          new MenuItem({
            label: 'Paste',
            enabled: params.editFlags.canPaste,
            click: () => wc.paste()
          })
        )
        menu.append(
          new MenuItem({
            label: 'Select All',
            enabled: params.editFlags.canSelectAll,
            click: () => wc.selectAll()
          })
        )
        menu.append(new MenuItem({ type: 'separator' }))
      }

      // Page context (always show)
      menu.append(
        new MenuItem({
          label: 'Back',
          enabled: wc.navigationHistory.canGoBack(),
          click: () => wc.goBack()
        })
      )
      menu.append(
        new MenuItem({
          label: 'Forward',
          enabled: wc.navigationHistory.canGoForward(),
          click: () => wc.goForward()
        })
      )
      menu.append(
        new MenuItem({
          label: 'Reload',
          click: () => wc.reload()
        })
      )

      menu.popup({ window: win })
    })
  }

  // Context menu actions
  executeContextAction(tabId: string, action: string, params: ContextMenuParams): boolean {
    const tabData = this.tabs.get(tabId)
    if (!tabData) return false

    const wc = tabData.view.webContents
    const windowId = tabData.windowId

    switch (action) {
      case 'back':
        wc.goBack()
        break
      case 'forward':
        wc.goForward()
        break
      case 'reload':
        wc.reload()
        break
      case 'copy':
      case 'copy-edit':
        wc.copy()
        break
      case 'cut':
        wc.cut()
        break
      case 'paste':
        wc.paste()
        break
      case 'undo':
        wc.undo()
        break
      case 'redo':
        wc.redo()
        break
      case 'select-all':
        wc.selectAll()
        break
      case 'copy-link':
        if (params.linkURL) {
          clipboard.writeText(params.linkURL)
        }
        break
      case 'copy-image-url':
        if (params.srcURL) {
          clipboard.writeText(params.srcURL)
        }
        break
      case 'open-link':
        if (params.linkURL) {
          const target = normalizeInteractiveBrowserUrl(params.linkURL)
          if (target) void wc.loadURL(target)
        }
        break
      case 'open-link-new-tab':
        if (params.linkURL) {
          this.createTab(windowId, params.linkURL)
        }
        break
      case 'open-image':
        if (params.srcURL) {
          this.createTab(windowId, params.srcURL)
        }
        break
      case 'save-image':
        if (params.srcURL) {
          wc.downloadURL(params.srcURL)
        }
        break
      case 'copy-image':
        if (params.srcURL) {
          wc.copyImageAt(params.x, params.y)
        }
        break
      case 'search-selection':
        if (params.selectionText) {
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`
          this.createTab(windowId, searchUrl)
        }
        break
      case 'save-page':
        wc.downloadURL(params.pageURL || wc.getURL())
        break
      default:
        return false
    }

    return true
  }

  // Cookie/site data management
  async getCookiesForSite(url: string): Promise<Electron.Cookie[]> {
    const browserSession = session.fromPartition(BROWSER_PARTITION)
    try {
      const parsedUrl = new URL(url)
      const cookies = await browserSession.cookies.get({ domain: parsedUrl.hostname })
      return cookies
    } catch {
      console.error('[BrowserManager] Failed to get cookies')
      return []
    }
  }

  async getCookieDomainsForSite(url: string): Promise<{ domain: string; cookieCount: number }[]> {
    const browserSession = session.fromPartition(BROWSER_PARTITION)
    try {
      const parsedUrl = new URL(url)
      const baseDomain = parsedUrl.hostname.split('.').slice(-2).join('.')
      const allCookies = await browserSession.cookies.get({})
      const domainCounts = new Map<string, number>()

      for (const cookie of allCookies) {
        const cookieDomain = cookie.domain?.startsWith('.')
          ? cookie.domain.substring(1)
          : cookie.domain || ''

        if (cookieDomain.endsWith(baseDomain) || baseDomain.endsWith(cookieDomain)) {
          const count = domainCounts.get(cookieDomain) || 0
          domainCounts.set(cookieDomain, count + 1)
        }
      }

      return Array.from(domainCounts.entries()).map(([domain, cookieCount]) => ({
        domain,
        cookieCount
      }))
    } catch {
      console.error('[BrowserManager] Failed to get cookie domains')
      return []
    }
  }

  async deleteCookiesForDomain(domain: string): Promise<boolean> {
    const browserSession = session.fromPartition(BROWSER_PARTITION)
    try {
      const cookies = await browserSession.cookies.get({ domain })
      for (const cookie of cookies) {
        const cookieUrl = `http${cookie.secure ? 's' : ''}://${cookie.domain?.startsWith('.') ? cookie.domain.substring(1) : cookie.domain}${cookie.path}`
        await browserSession.cookies.remove(cookieUrl, cookie.name)
      }
      return true
    } catch {
      console.error('[BrowserManager] Failed to delete cookies for domain')
      return false
    }
  }

  async clearAllSiteData(url: string): Promise<boolean> {
    const browserSession = session.fromPartition(BROWSER_PARTITION)
    try {
      const parsedUrl = new URL(url)
      await browserSession.clearStorageData({
        origin: parsedUrl.origin,
        storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage']
      })
      return true
    } catch {
      console.error('[BrowserManager] Failed to clear site data')
      return false
    }
  }

  getSecurityInfo(url: string): { isSecure: boolean; protocol: string } {
    try {
      const parsedUrl = new URL(url)
      return {
        isSecure: parsedUrl.protocol === 'https:',
        protocol: parsedUrl.protocol
      }
    } catch {
      return { isSecure: false, protocol: 'unknown' }
    }
  }

  async clearAllCookies(): Promise<boolean> {
    const browserSession = session.fromPartition(BROWSER_PARTITION)
    try {
      await browserSession.clearStorageData({ storages: ['cookies'] })
      return true
    } catch {
      console.error('[BrowserManager] Failed to clear all cookies')
      return false
    }
  }

  // Get ALL cookies grouped by domain
  async getAllCookieDomains(): Promise<{ domain: string; cookieCount: number }[]> {
    const browserSession = session.fromPartition(BROWSER_PARTITION)
    try {
      const allCookies = await browserSession.cookies.get({})
      const domainCounts = new Map<string, number>()

      for (const cookie of allCookies) {
        const cookieDomain = cookie.domain?.startsWith('.')
          ? cookie.domain.substring(1)
          : cookie.domain || ''

        const count = domainCounts.get(cookieDomain) || 0
        domainCounts.set(cookieDomain, count + 1)
      }

      return Array.from(domainCounts.entries())
        .map(([domain, cookieCount]) => ({ domain, cookieCount }))
        .sort((a, b) => a.domain.localeCompare(b.domain))
    } catch {
      console.error('[BrowserManager] Failed to get all cookie domains')
      return []
    }
  }

  // Get all cookies for a specific domain
  async getCookiesForDomain(domain: string): Promise<Electron.Cookie[]> {
    const browserSession = session.fromPartition(BROWSER_PARTITION)
    try {
      const allCookies = await browserSession.cookies.get({})
      return allCookies.filter((cookie) => {
        const cookieDomain = cookie.domain?.startsWith('.')
          ? cookie.domain.substring(1)
          : cookie.domain || ''
        return (
          cookieDomain === domain ||
          cookieDomain.endsWith('.' + domain) ||
          domain.endsWith('.' + cookieDomain)
        )
      })
    } catch {
      console.error('[BrowserManager] Failed to get cookies for domain')
      return []
    }
  }

  // Get ALL saved permissions grouped by origin
  getAllSavedPermissions(): {
    origin: string
    permissions: { permission: string; granted: boolean }[]
  }[] {
    const result: { origin: string; permissions: { permission: string; granted: boolean }[] }[] = []

    for (const [origin, permMap] of this.savedPermissions.entries()) {
      const permissions: { permission: string; granted: boolean }[] = []
      for (const [permission, decision] of permMap.entries()) {
        if (decision.expiresAt <= Date.now()) continue
        permissions.push({ permission, granted: decision.granted })
      }
      if (permissions.length > 0) {
        result.push({ origin, permissions })
      }
    }

    return result.sort((a, b) => a.origin.localeCompare(b.origin))
  }

  getActiveTabWebContents(windowId: number): Electron.WebContents | null {
    const activeTabId = this.activeTabByWindow.get(windowId)
    if (!activeTabId) return null
    const tabData = this.tabs.get(activeTabId)
    if (!tabData) return null
    return tabData.view.webContents
  }

  isTabOwnedByWindow(windowId: number, tabId: string): boolean {
    return this.tabs.get(tabId)?.windowId === windowId
  }

  // Delete all permissions for a specific origin
  deletePermissionsForOrigin(origin: string): boolean {
    if (this.savedPermissions.has(origin)) {
      this.savedPermissions.delete(origin)
      this.savePermissions()
      return true
    }
    return false
  }

  // Delete a specific permission for an origin
  deletePermission(origin: string, permission: string): boolean {
    const permMap = this.savedPermissions.get(origin)
    if (permMap && permMap.has(permission)) {
      permMap.delete(permission)
      if (permMap.size === 0) {
        this.savedPermissions.delete(origin)
      }
      this.savePermissions()
      return true
    }
    return false
  }
}

// Singleton instance
export const browserManager = new BrowserManager()

function senderOwnsTab(event: Electron.IpcMainInvokeEvent, tabId: string): boolean {
  const window = BrowserWindow.fromWebContents(event.sender)
  return !!window && browserManager.isTabOwnedByWindow(window.id, tabId)
}

// Register IPC handlers
export function registerBrowserIPC(): void {
  ipcMain.handle('browser:ensure-window', async (event, createInitialTab = false) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    browserManager.registerWindow(win, {
      createInitialTab,
      enableClickThrough: false,
      closeWindowOnLastTab: false
    })
    return true
  })

  ipcMain.handle('browser:create-tab', async (event, url?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    return browserManager.createTab(win.id, url)
  })

  ipcMain.handle('browser:close-tab', async (event, tabId: string) => {
    if (!senderOwnsTab(event, tabId)) return false
    return browserManager.closeTab(tabId)
  })

  ipcMain.handle('browser:switch-tab', async (event, tabId: string) => {
    if (!senderOwnsTab(event, tabId)) return false
    return browserManager.switchTab(tabId)
  })

  ipcMain.handle('browser:navigate', async (event, tabId: string, url: string) => {
    if (!senderOwnsTab(event, tabId)) return false
    return browserManager.navigate(tabId, url)
  })

  ipcMain.handle('browser:go-back', async (event, tabId: string) => {
    if (!senderOwnsTab(event, tabId)) return false
    return browserManager.goBack(tabId)
  })

  ipcMain.handle('browser:go-forward', async (event, tabId: string) => {
    if (!senderOwnsTab(event, tabId)) return false
    return browserManager.goForward(tabId)
  })

  ipcMain.handle('browser:reload', async (event, tabId: string) => {
    if (!senderOwnsTab(event, tabId)) return false
    return browserManager.reload(tabId)
  })

  ipcMain.handle('browser:stop', async (event, tabId: string) => {
    if (!senderOwnsTab(event, tabId)) return false
    return browserManager.stop(tabId)
  })

  ipcMain.handle('browser:hard-reload', async (event, tabId: string) => {
    if (!senderOwnsTab(event, tabId)) return false
    return browserManager.hardReload(tabId)
  })

  ipcMain.handle('browser:reopen-closed-tab', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    return browserManager.reopenClosedTab(win.id)
  })

  ipcMain.handle('browser:get-tab-by-index', async (event, index: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    return browserManager.getTabByIndex(win.id, index)
  })

  ipcMain.handle('browser:get-next-tab', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    return browserManager.getNextTab(win.id)
  })

  ipcMain.handle('browser:get-previous-tab', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    return browserManager.getPreviousTab(win.id)
  })

  ipcMain.handle('browser:get-tab-count', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return 0
    return browserManager.getTabCount(win.id)
  })

  ipcMain.handle('browser:get-tab-info', async (event, tabId: string) => {
    if (!senderOwnsTab(event, tabId)) return null
    return browserManager.getTabInfo(tabId)
  })

  ipcMain.handle('browser:get-tabs', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return []
    return browserManager.getTabsForWindow(win.id)
  })

  ipcMain.handle('browser:get-active-tab', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    return browserManager.getActiveTabId(win.id)
  })

  ipcMain.handle('browser:get-history', async () => {
    return browserManager.getHistory()
  })

  ipcMain.handle('browser:clear-history', async () => {
    browserManager.clearHistory()
    return true
  })

  ipcMain.handle('browser:delete-history-entry', async (_event, id: string) => {
    browserManager.deleteHistoryEntry(id)
    return true
  })

  ipcMain.handle('browser:get-downloads', async () => {
    return browserManager.getDownloads()
  })

  ipcMain.handle('browser:pause-download', async (_event, downloadId: string) => {
    return browserManager.pauseDownload(downloadId)
  })

  ipcMain.handle('browser:resume-download', async (_event, downloadId: string) => {
    return browserManager.resumeDownload(downloadId)
  })

  ipcMain.handle('browser:cancel-download', async (_event, downloadId: string) => {
    return browserManager.cancelDownload(downloadId)
  })

  ipcMain.handle('browser:open-downloads-folder', async () => {
    browserManager.openDownloadsFolder()
    return true
  })

  ipcMain.handle('browser:set-side-panel-width', async (event, width: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    browserManager.setSidePanelWidth(win.id, width)
    return true
  })

  ipcMain.handle('browser:set-left-panel-width', async (event, width: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    browserManager.setLeftPanelWidth(win.id, width)
    return true
  })

  ipcMain.handle('browser:set-bottom-bar-height', async (event, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    browserManager.setBottomBarHeight(win.id, height)
    return true
  })

  ipcMain.handle('browser:set-top-bar-height', async (event, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    browserManager.setTopBarHeight(win.id, height)
    return true
  })

  ipcMain.handle(
    'browser:set-panel-bounds',
    async (
      event,
      bounds: { x: number; y: number; width: number; height: number; borderRadius: number }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return false
      browserManager.setPanelBounds(win.id, bounds)
      return true
    }
  )

  // Find in page handlers
  ipcMain.handle(
    'browser:find-in-page',
    async (
      event,
      tabId: string,
      text: string,
      options: { forward?: boolean; findNext?: boolean }
    ) => {
      if (!senderOwnsTab(event, tabId)) return false
      return browserManager.findInPage(tabId, text, options)
    }
  )

  ipcMain.handle(
    'browser:stop-find-in-page',
    async (
      event,
      tabId: string,
      action: 'clearSelection' | 'keepSelection' | 'activateSelection'
    ) => {
      if (!senderOwnsTab(event, tabId)) return false
      return browserManager.stopFindInPage(tabId, action)
    }
  )

  // Permission handlers
  ipcMain.handle(
    'browser:resolve-permission',
    async (
      event,
      requestId: string,
      granted: boolean,
      remember: boolean,
      _origin?: string,
      _permission?: string
    ) => {
      return browserManager.resolvePermission(
        requestId,
        granted === true,
        remember === true,
        event.sender.id
      )
    }
  )

  // Context menu action handler
  ipcMain.handle(
    'browser:context-action',
    async (event, tabId: string, action: string, params: ContextMenuParams) => {
      if (!senderOwnsTab(event, tabId)) return false
      return browserManager.executeContextAction(tabId, action, params)
    }
  )

  // Hide all tabs (for settings view)
  ipcMain.handle('browser:hide-all-tabs', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    browserManager.hideAllTabs(win.id)
    return true
  })

  // Show active tab (when closing settings)
  ipcMain.handle('browser:show-active-tab', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    browserManager.showActiveTab(win.id)
    return true
  })

  // Close all tabs (Cmd+Shift+W)
  ipcMain.handle('browser:close-all-tabs', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    browserManager.closeAllTabs(win.id)
    return true
  })

  // Close tab or open new if last (Cmd+W behavior)
  ipcMain.handle('browser:close-tab-or-new', async (event, tabId: string) => {
    if (!senderOwnsTab(event, tabId)) return false
    return browserManager.closeTabOrOpenNew(tabId)
  })

  // Cookie/site data handlers
  ipcMain.handle('browser:get-cookies-for-site', async (_event, url: string) => {
    return browserManager.getCookiesForSite(url)
  })

  ipcMain.handle('browser:get-cookie-domains', async (_event, url: string) => {
    return browserManager.getCookieDomainsForSite(url)
  })

  ipcMain.handle('browser:delete-cookies-for-domain', async (_event, domain: string) => {
    return browserManager.deleteCookiesForDomain(domain)
  })

  ipcMain.handle('browser:clear-site-data', async (_event, url: string) => {
    return browserManager.clearAllSiteData(url)
  })

  ipcMain.handle('browser:get-security-info', async (_event, url: string) => {
    return browserManager.getSecurityInfo(url)
  })

  // Clear ALL cookies
  ipcMain.handle('browser:clear-all-cookies', async () => {
    return browserManager.clearAllCookies()
  })

  // Get ALL cookie domains (comprehensive list)
  ipcMain.handle('browser:get-all-cookie-domains', async () => {
    return browserManager.getAllCookieDomains()
  })

  // Get cookies for a specific domain
  ipcMain.handle('browser:get-cookies-for-domain', async (_event, domain: string) => {
    return browserManager.getCookiesForDomain(domain)
  })

  // Get ALL saved permissions
  ipcMain.handle('browser:get-all-permissions', async () => {
    return browserManager.getAllSavedPermissions()
  })

  // Delete all permissions for an origin
  ipcMain.handle('browser:delete-permissions-for-origin', async (_event, origin: string) => {
    return browserManager.deletePermissionsForOrigin(origin)
  })

  // Delete a specific permission
  ipcMain.handle(
    'browser:delete-permission',
    async (_event, origin: string, permission: string) => {
      return browserManager.deletePermission(origin, permission)
    }
  )
}
