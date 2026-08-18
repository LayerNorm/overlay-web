import { useState, useEffect, useCallback, ReactElement, useRef } from 'react'
import { PanelLeft, MessageCircle } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'
import { BrowserAgentChat } from './BrowserAgentChat'
import { BrowserEmptyState } from './BrowserEmptyState'
import { getTheme } from '../../utils/theme'
import DockablePanel from '../DockablePanel'
import { useDockableDrag } from '../DockablePanelContext'
import { FindBar } from './FindBar'
import { TabBar } from './TabBar'
import { Toolbar } from './Toolbar'
import { HistorySidebar, DownloadsSidebar, BookmarksSidebar } from './Sidebars'
import { SiteInfoSidebar } from './SiteInfoSidebar'
import { SettingsPanel } from './Settings'
import { BrowserStyles } from './common'
import { ResizableDivider } from '../ui/ResizableDivider'
import { SettingsTab, CookieDomain, CookieDetail, SavedPermission } from './types'
import {
  useBrowserTabs,
  useBrowserNavigation,
  useBrowserHistory,
  useBrowserBookmarks,
  useBrowserDownloads,
  useSidebarState,
  useBrowserKeyboardShortcuts,
  useBrowserPermissions
} from './hooks'
import { markPanelHydrateComplete, signalPanelShellReady } from '../../utils/panelLatency'

const FIND_BAR_HEIGHT = 36
const DEFAULT_CHAT_WIDTH = 400
const EMBEDDED_TABBAR_HEIGHT = 40

interface BrowserPanelProps {
  embedded?: boolean
  headerLeftSlot?: React.ReactNode
}

// Inner component for draggable spacer - must be inside DockablePanel to access context
function DraggableSpacer(): React.ReactElement<any> {
  const { startDrag } = useDockableDrag()
  return (
    <div
      onMouseDown={startDrag}
      style={
        {
          flex: 1,
          height: 36,
          WebkitAppRegion: 'no-drag',
          pointerEvents: 'auto'
        } as React.CSSProperties
      }
    />
  )
}

export function BrowserPanel({ embedded = false, headerLeftSlot }: BrowserPanelProps = {}): ReactElement<any> {
  const { settings } = useSettings()
  const theme = {
    ...getTheme(settings.darkMode, settings.lightThemePreset, settings.darkThemePreset),
    isDark: settings.darkMode
  }
  const containerRef = useRef<HTMLDivElement>(null)

  // Tab management
  const {
    tabs,
    activeTabId,
    activeTab,
    createNewTab,
    closeTab,
    switchTab,
    reorderTabs,
    downloads,
    setDownloads
  } = useBrowserTabs()

  // Navigation
  const { goBack, goForward, reload, isLoading, canGoBack, canGoForward } = useBrowserNavigation({
    activeTabId,
    activeTab
  })

  // URL bar state
  const [inputUrl, setInputUrl] = useState('')
  const [originalUrl, setOriginalUrl] = useState('')
  const [isUrlFocused, setIsUrlFocused] = useState(false)
  const urlInputRef = useRef<HTMLInputElement>(null)

  // Settings state
  const [showSettings, setShowSettings] = useState(false)
  const [isSettingsTabOpen, setIsSettingsTabOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('shortcuts')

  // Find bar state
  const [showFindBar, setShowFindBar] = useState(false)

  // Content protection
  const [contentProtection, setContentProtection] = useState(false)

  // Header lock state
  const [headerLocked, setHeaderLocked] = useState(true)
  const [isPanelHovered, setIsPanelHovered] = useState(true)

  // Chat sidebar state
  const [showChat, setShowChat] = useState(false)
  const [chatWidth, setChatWidth] = useState(() => {
    const saved = localStorage.getItem('overlay-browser-chat-width')
    return saved ? parseInt(saved, 10) : DEFAULT_CHAT_WIDTH
  })

  // Maximize state for traffic light buttons
  const [isMaximized, setIsMaximized] = useState(false)

  // Mount state to prevent flash on initial render
  const [isMounted, setIsMounted] = useState(false)

  // Security state
  const [isSecure, setIsSecure] = useState(false)

  // Settings panel cookies & permissions state
  const [allCookieDomains, setAllCookieDomains] = useState<CookieDomain[]>([])
  const [expandedCookieDomain, setExpandedCookieDomain] = useState<string | null>(null)
  const [domainCookies, setDomainCookies] = useState<CookieDetail[]>([])
  const [savedPermissions, setSavedPermissions] = useState<SavedPermission[]>([])
  const [expandedPermissionOrigin, setExpandedPermissionOrigin] = useState<string | null>(null)

  // Sidebar state
  const {
    showHistory,
    showDownloads,
    showBookmarks,
    showSiteInfo,
    activeSidebar,
    setShowSiteInfo,
    closeSidebar,
    toggleHistory,
    toggleDownloads,
    toggleBookmarks
  } = useSidebarState()

  // History management
  const { history, clearHistory, openHistoryUrl } = useBrowserHistory({
    showHistory,
    showSettings,
    settingsTab,
    activeTabId
  })

  // Bookmarks management
  const { bookmarks, removeBookmark, toggleBookmark, openBookmarkUrl, isCurrentPageBookmarked } =
    useBrowserBookmarks({
      showBookmarks,
      showSettings,
      settingsTab,
      activeTab,
      activeTabId
    })

  // Downloads management
  useBrowserDownloads({
    showDownloads,
    showSettings,
    settingsTab,
    downloads,
    setDownloads
  })

  // Permissions
  const { permissionRequest, handleAllowPermission, handleDenyPermission } = useBrowserPermissions()

  // Hover detection via main-process cursor polling.
  // document mousemove doesn't fire over the native WebContentsView,
  // so the main process polls screen.getCursorScreenPoint() and sends
  // the result via IPC.
  useEffect(() => {
    if (embedded) return
    if (headerLocked) {
      setIsPanelHovered(true)
      return
    }
    const unsub = window.bridge.browser.onCursorInPanel((isInside) => {
      setIsPanelHovered(isInside)
    })
    return unsub
  }, [embedded, headerLocked])

  // Keyboard shortcuts
  useBrowserKeyboardShortcuts({
    activeTabId,
    activeTab,
    showFindBar,
    showSettings,
    showSiteInfo,
    showChat,
    originalUrl,
    urlInputRef,
    setInputUrl,
    setShowFindBar,
    setShowSettings,
    setIsSettingsTabOpen,
    setSettingsTab,
    goBack,
    goForward,
    createNewTab,
    closeTab,
    toggleSiteInfo: () => setShowSiteInfo(!showSiteInfo),
    toggleChat: () => setShowChat(!showChat)
  })

  // Sync input URL with active tab URL
  useEffect(() => {
    if (activeTab?.url) {
      setInputUrl(activeTab.url)
    }
  }, [activeTab?.url])

  // Notify main process when find bar is visible
  useEffect(() => {
    const embeddedOffset = embedded ? -EMBEDDED_TABBAR_HEIGHT : 0
    window.bridge.browser.setTopBarHeight(embeddedOffset + (showFindBar ? FIND_BAR_HEIGHT : 0))
  }, [embedded, showFindBar])

  // Notify main process about bottom bar height (always 56px for embedded buttons)
  useEffect(() => {
    window.bridge.browser.setBottomBarHeight(56)
    return () => {
      window.bridge.browser.setBottomBarHeight(0)
    }
  }, [])

  // Notify main process about chat sidebar width so WebContentsView shrinks accordingly
  useEffect(() => {
    window.bridge.browser.setSidePanelWidth(showChat ? chatWidth : 0)
  }, [showChat, chatWidth])

  // Sync the browser surface bounds to the main process. Re-runs when tabs
  // appear/disappear because containerRef only exists while the surface is
  // rendered — with zero tabs the empty state renders instead, so a mount-only
  // effect would never sync bounds once the first tab is created.
  const hasTabs = tabs.length > 0
  useEffect(() => {
    if (!embedded || !hasTabs) return

    const syncBounds = (): void => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      void window.bridge.browser.setPanelBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        borderRadius: 0
      })
    }

    syncBounds()

    // Re-show the active tab's WebContentsView — a previous unmount hides all
    // views via hideAllTabs(), and nothing else restores visibility on remount
    void window.bridge.browser.showActiveTab()

    const resizeObserver = new ResizeObserver(() => {
      syncBounds()
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    window.addEventListener('resize', syncBounds)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', syncBounds)
    }
  }, [embedded, hasTabs])

  // Reset native view state when the embedded browser unmounts
  useEffect(() => {
    if (!embedded) return
    return () => {
      void window.bridge.browser.hideAllTabs()
      void window.bridge.browser.setSidePanelWidth(0)
      void window.bridge.browser.setLeftPanelWidth(0)
      void window.bridge.browser.setBottomBarHeight(0)
      void window.bridge.browser.setTopBarHeight(0)
      void window.bridge.browser.setPanelBounds({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        borderRadius: 0
      })
    }
  }, [embedded])

  // Paint shell immediately; signal preload-ready without waiting on tab hydration
  useEffect(() => {
    setIsMounted(true)
    signalPanelShellReady('browser')
    markPanelHydrateComplete('browser')
  }, [])

  // URL submission handler
  const handleUrlSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (activeTabId && inputUrl.trim()) {
      window.bridge.browser.navigate(activeTabId, inputUrl.trim())
    }
  }

  // URL focus handler
  const handleUrlFocus = (e: React.FocusEvent<HTMLInputElement>): void => {
    setOriginalUrl(inputUrl)
    setIsUrlFocused(true)
    e.target.select()
  }

  // URL keydown handler for Cmd+Enter
  const handleUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (inputUrl.trim()) {
        window.bridge.browser.createTab(inputUrl.trim())
      }
    }
  }

  // Toggle content protection
  const toggleContentProtection = async (): Promise<void> => {
    const newValue = !contentProtection
    setContentProtection(newValue)
    await window.bridge.setContentProtection('browser', newValue)
  }

  // Toggle settings
  const toggleSettings = useCallback((): void => {
    if (showSettings) {
      setShowSettings(false)
      setIsSettingsTabOpen(false)
      window.bridge.browser.showActiveTab()
    } else {
      setSettingsTab('shortcuts')
      setShowSettings(true)
      setIsSettingsTabOpen(true)
      window.bridge.browser.hideAllTabs()
    }
  }, [showSettings])

  // Tab selection handler
  const handleTabSelect = useCallback(
    (tabId: string): void => {
      if (showSettings) {
        setShowSettings(false)
        window.bridge.browser.showActiveTab()
      }
      switchTab(tabId)
    },
    [showSettings, switchTab]
  )

  // Settings tab selection
  const handleSettingsSelect = useCallback((): void => {
    setShowSettings(true)
    window.bridge.browser.hideAllTabs()
  }, [])

  // Settings tab close
  const handleSettingsClose = useCallback((): void => {
    setShowSettings(false)
    setIsSettingsTabOpen(false)
    window.bridge.browser.showActiveTab()
  }, [])

  // Toggle site info sidebar
  const handleToggleSiteInfo = useCallback(async (): Promise<void> => {
    if (showSiteInfo) {
      setShowSiteInfo(false)
    } else {
      if (activeTab?.url) {
        const securityInfo = await window.bridge.browser.getSecurityInfo(activeTab.url)
        setIsSecure(securityInfo.isSecure)
      }
      setShowSiteInfo(true)
    }
  }, [showSiteInfo, activeTab?.url, setShowSiteInfo])

  // Find bar close handler
  const closeFindBar = useCallback((): void => {
    setShowFindBar(false)
  }, [])

  // Settings panel handlers
  const handleLoadAllCookies = useCallback(async (): Promise<void> => {
    const domains = await window.bridge.browser.getAllCookieDomains()
    setAllCookieDomains(domains)
    setExpandedCookieDomain(null)
    setDomainCookies([])
  }, [])

  const handleLoadDomainCookies = useCallback(async (domain: string): Promise<CookieDetail[]> => {
    const cookies = await window.bridge.browser.getCookiesForDomainDetail(domain)
    setDomainCookies(cookies)
    return cookies
  }, [])

  const handleDeleteCookiesForDomain = useCallback(
    async (domain: string): Promise<void> => {
      await window.bridge.browser.deleteCookiesForDomain(domain)
      const domains = await window.bridge.browser.getAllCookieDomains()
      setAllCookieDomains(domains)
      if (expandedCookieDomain === domain) {
        setExpandedCookieDomain(null)
        setDomainCookies([])
      }
    },
    [expandedCookieDomain]
  )

  const handleLoadPermissions = useCallback(async (): Promise<void> => {
    const perms = await window.bridge.browser.getAllPermissions()
    setSavedPermissions(perms)
    setExpandedPermissionOrigin(null)
  }, [])

  const handleDeletePermissionsForOrigin = useCallback(
    async (origin: string): Promise<void> => {
      await window.bridge.browser.deletePermissionsForOrigin(origin)
      const perms = await window.bridge.browser.getAllPermissions()
      setSavedPermissions(perms)
      if (expandedPermissionOrigin === origin) {
        setExpandedPermissionOrigin(null)
      }
    },
    [expandedPermissionOrigin]
  )

  const handleDeletePermission = useCallback(
    async (origin: string, permission: string): Promise<void> => {
      await window.bridge.browser.deletePermission(origin, permission)
      const perms = await window.bridge.browser.getAllPermissions()
      setSavedPermissions(perms)
    },
    []
  )

  const handleOpenHistoryUrl = useCallback(
    (url: string): void => {
      openHistoryUrl(url, () => {
        if (showSettings) setShowSettings(false)
      })
    },
    [openHistoryUrl, showSettings]
  )

  const handleOpenBookmarkUrl = useCallback(
    (url: string): void => {
      openBookmarkUrl(url, () => {
        if (showSettings) setShowSettings(false)
      })
    },
    [openBookmarkUrl, showSettings]
  )

  // Extra width for chat sidebar - expands panel to the right
  const extraWidth = showChat ? chatWidth : 0

  const browserSurface = (
    <div
      ref={containerRef}
      onMouseEnter={() => setIsPanelHovered(true)}
      onMouseLeave={() => setIsPanelHovered(false)}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: embedded
          ? theme.background
          : !headerLocked && !isPanelHovered
            ? 'transparent'
            : theme.surface,
        borderRadius: embedded ? 0 : 'var(--dockable-border-radius, 12px)',
        overflow: 'hidden',
        borderWidth: embedded ? 0 : 'var(--dockable-border-width, 1px)',
        borderStyle: embedded ? 'none' : 'solid',
        borderColor: embedded
          ? 'transparent'
          : !headerLocked && !isPanelHovered
            ? 'transparent'
            : theme.border,
        opacity: isMounted ? 1 : 0,
        transition: 'background 0.2s ease-out, border-color 0.2s ease-out, opacity 0.15s ease-out'
      }}
    >
        {!embedded && (
          <div
            style={{
              opacity: headerLocked || isPanelHovered ? 1 : 0,
              pointerEvents:
                headerLocked || isPanelHovered ? ('auto' as const) : ('none' as const),
              transition: 'opacity 0.2s ease-out',
              background: theme.background
            }}
          >
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              showSettings={showSettings}
              isSettingsTabOpen={isSettingsTabOpen}
              theme={theme}
              onTabSelect={handleTabSelect}
              onTabClose={closeTab}
              onNewTab={createNewTab}
              onSettingsSelect={handleSettingsSelect}
              onSettingsClose={handleSettingsClose}
              onReorderTabs={reorderTabs}
              onPanelClose={() => window.bridge.destroyPanel()}
              onPanelMinimize={() => window.bridge.hidePanel('browser')}
              onPanelMaximize={async () => {
                const result = await window.bridge.maximizePanel()
                if (result.success) setIsMaximized(result.isMaximized)
              }}
              isMaximized={isMaximized}
              contentProtection={contentProtection}
              onToggleContentProtection={toggleContentProtection}
              headerLocked={headerLocked}
              onToggleHeaderLock={() => setHeaderLocked(!headerLocked)}
            />
          </div>
        )}

        <div
          style={{
            opacity: embedded || headerLocked || isPanelHovered ? 1 : 0,
            pointerEvents:
              embedded || headerLocked || isPanelHovered ? ('auto' as const) : ('none' as const),
            transition: 'opacity 0.2s ease-out',
            background: theme.background
          }}
        >
          <Toolbar
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            isLoading={isLoading}
            inputUrl={inputUrl}
            isUrlFocused={isUrlFocused}
            isCurrentPageBookmarked={isCurrentPageBookmarked}
            showHistory={showHistory}
            showDownloads={showDownloads}
            showBookmarks={showBookmarks}
            showSettings={showSettings}
            theme={theme}
            urlInputRef={urlInputRef}
            onGoBack={goBack}
            onGoForward={goForward}
            onReload={reload}
            onUrlChange={setInputUrl}
            onUrlSubmit={handleUrlSubmit}
            onUrlFocus={handleUrlFocus}
            onUrlBlur={() => setIsUrlFocused(false)}
            onUrlKeyDown={handleUrlKeyDown}
            onAddBookmark={toggleBookmark}
            onToggleHistory={toggleHistory}
            onToggleDownloads={toggleDownloads}
            onToggleBookmarks={toggleBookmarks}
            onOpenSettings={toggleSettings}
            headerLeftSlot={headerLeftSlot}
          />
        </div>

        {/* Find Bar */}
        {!showSettings && (
          <FindBar isOpen={showFindBar} onClose={closeFindBar} tabId={activeTabId} theme={theme} />
        )}

        {/* Main content area (hidden when settings is open) */}
        {!showSettings && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              position: 'relative',
              minHeight: 0,
              pointerEvents: 'auto'
            }}
          >
            {/* WebContentsView area */}
            <div
              style={{ flex: 1, pointerEvents: 'auto' }}
              onClick={() => {
                if (activeSidebar) closeSidebar()
              }}
            />

            {/* Right Sidebars */}
            {showHistory && (
              <HistorySidebar
                history={history}
                theme={theme}
                onClose={closeSidebar}
                onClear={clearHistory}
                onOpenUrl={(url) => openHistoryUrl(url, closeSidebar)}
              />
            )}

            {showDownloads && (
              <DownloadsSidebar downloads={downloads} theme={theme} onClose={closeSidebar} />
            )}

            {showBookmarks && (
              <BookmarksSidebar
                bookmarks={bookmarks}
                theme={theme}
                onClose={closeSidebar}
                onOpenUrl={(url) => openBookmarkUrl(url, closeSidebar)}
                onRemove={removeBookmark}
              />
            )}

            {/* Left Sidebar - Site Info */}
            {showSiteInfo && (
              <SiteInfoSidebar
                currentUrl={activeTab?.url}
                isSecure={isSecure}
                theme={theme}
                onClose={closeSidebar}
              />
            )}

            {/* Resizable divider between WebContentsView and chat */}
            {showChat && (
              <ResizableDivider
                direction="horizontal"
                onResize={(delta) => {
                  setChatWidth((prev) => {
                    const newWidth = Math.min(Math.max(prev + delta, 240), 600)
                    localStorage.setItem('overlay-browser-chat-width', String(newWidth))
                    window.bridge.browser.setSidePanelWidth(newWidth)
                    return newWidth
                  })
                }}
                theme={theme}
              />
            )}

            {/* Right Sidebar - Chat (flex item to expand panel) */}
            {showChat && (
              <div
                style={{
                  width: chatWidth,
                  height: '100%',
                  background: theme.background,
                  display: 'flex',
                  flexDirection: 'column',
                  flexShrink: 0,
                  pointerEvents: 'auto'
                }}
              >
                <BrowserAgentChat
                  theme={{
                    text: theme.text,
                    textSecondary: theme.textSecondary,
                    background: theme.background,
                    surface: theme.surface,
                    border: theme.border,
                    isDark: theme.isDark
                  }}
                  onClose={() => setShowChat(false)}
                  activeTabId={activeTabId}
                />
              </div>
            )}
          </div>
        )}

        {/* Settings Panel (replaces content area when open) */}
        {showSettings && (
          <SettingsPanel
            settingsTab={settingsTab}
            theme={theme}
            history={history}
            downloads={downloads}
            bookmarks={bookmarks}
            allCookieDomains={allCookieDomains}
            expandedCookieDomain={expandedCookieDomain}
            domainCookies={domainCookies}
            savedPermissions={savedPermissions}
            expandedPermissionOrigin={expandedPermissionOrigin}
            onSetSettingsTab={setSettingsTab}
            onClearHistory={clearHistory}
            onOpenHistoryUrl={handleOpenHistoryUrl}
            onOpenBookmarkUrl={handleOpenBookmarkUrl}
            onLoadAllCookies={handleLoadAllCookies}
            onExpandCookieDomain={setExpandedCookieDomain}
            onLoadDomainCookies={handleLoadDomainCookies}
            onDeleteCookiesForDomain={handleDeleteCookiesForDomain}
            onLoadPermissions={handleLoadPermissions}
            onExpandPermissionOrigin={setExpandedPermissionOrigin}
            onDeletePermissionsForOrigin={handleDeletePermissionsForOrigin}
            onDeletePermission={handleDeletePermission}
          />
        )}

        {/* Embedded bottom bar in frame border - flex item so webContentsView accounts for it */}
        <div
          style={
            {
              flexShrink: 0,
              minHeight: 56,
              background: embedded ? theme.background : theme.surface,
              borderTop: `1px solid ${theme.border}`,
              opacity: embedded || headerLocked || isPanelHovered ? 1 : 0,
              overflow: embedded || headerLocked || isPanelHovered ? 'visible' : 'hidden',
              transition: 'opacity 0.2s ease, padding 0.25s ease',
              padding: '4px 16px 8px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              pointerEvents: 'auto'
            } as React.CSSProperties
          }
        >
          {/* Button row - draggable region for window movement */}
          <div
            style={
              {
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                minHeight: 36,
                WebkitAppRegion: embedded ? 'no-drag' : 'drag'
              } as React.CSSProperties
            }
          >
            {/* Site Info Sidebar toggle button */}
            <button
              onClick={handleToggleSiteInfo}
              title={showSiteInfo ? 'Hide site info' : 'Show site info'}
              style={
                {
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: showSiteInfo
                    ? theme.isDark
                      ? 'rgba(255, 255, 255, 0.15)'
                      : 'rgba(0, 0, 0, 0.1)'
                    : 'transparent',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                  WebkitAppRegion: 'no-drag'
                } as React.CSSProperties
              }
              onMouseEnter={(e) => {
                e.currentTarget.style.background = theme.isDark
                  ? 'rgba(255, 255, 255, 0.15)'
                  : 'rgba(0, 0, 0, 0.1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = showSiteInfo
                  ? theme.isDark
                    ? 'rgba(255, 255, 255, 0.15)'
                    : 'rgba(0, 0, 0, 0.1)'
                  : 'transparent'
              }}
            >
              <PanelLeft size={16} color={theme.text} />
            </button>

            {/* Spacer or Permission Prompt - permission prompt replaces spacer when active */}
            {permissionRequest ? (
              <div
                style={
                  {
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '0 12px',
                    background: theme.surface,
                    borderRadius: 8,
                    height: 36,
                    WebkitAppRegion: 'no-drag'
                  } as React.CSSProperties
                }
              >
                <span
                  style={{
                    fontSize: 11,
                    color: theme.text,
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1
                  }}
                >
                  {permissionRequest.permission === 'media'
                    ? 'Camera & Microphone access'
                    : permissionRequest.permission === 'geolocation'
                      ? 'Location access'
                      : permissionRequest.permission === 'notifications'
                        ? 'Show notifications'
                        : permissionRequest.permission === 'clipboard-read'
                          ? 'Read clipboard'
                          : permissionRequest.permission === 'display-capture'
                            ? 'Screen capture'
                            : `${permissionRequest.permission} access`}
                </span>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    cursor: 'pointer',
                    fontSize: 11,
                    color: theme.textSecondary,
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                    flexShrink: 0
                  }}
                >
                  <input
                    type="checkbox"
                    id="remember-permission"
                    style={{ width: 12, height: 12, cursor: 'pointer' }}
                  />
                  Remember
                </label>
                <button
                  onClick={() => {
                    const checkbox = document.getElementById(
                      'remember-permission'
                    ) as HTMLInputElement
                    handleDenyPermission(permissionRequest.id, checkbox?.checked || false)
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: `1px solid ${theme.border}`,
                    background: 'transparent',
                    color: theme.text,
                    fontSize: 11,
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                    fontWeight: 500,
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.isDark
                      ? 'rgba(255, 255, 255, 0.08)'
                      : 'rgba(0, 0, 0, 0.05)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  Block
                </button>
                <button
                  onClick={() => {
                    const checkbox = document.getElementById(
                      'remember-permission'
                    ) as HTMLInputElement
                    handleAllowPermission(permissionRequest.id, checkbox?.checked || false)
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#3b82f6',
                    color: '#fff',
                    fontSize: 11,
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                    fontWeight: 500,
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#2563eb'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#3b82f6'
                  }}
                >
                  Allow
                </button>
                <button
                  onClick={() => handleDenyPermission(permissionRequest.id, false)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.6,
                    flexShrink: 0,
                    transition: 'opacity 0.15s ease',
                    color: 'white'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '1'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0.6'
                  }}
                  title="Dismiss"
                >
                  ×
                </button>
              </div>
            ) : embedded ? (
              <div style={{ flex: 1, height: 36 }} />
            ) : (
              <DraggableSpacer />
            )}

            {/* Chat sidebar toggle button */}
            <button
              onClick={() => setShowChat(!showChat)}
              title={showChat ? 'Hide chat' : 'Show chat'}
              style={
                {
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: showChat
                    ? theme.isDark
                      ? 'rgba(255, 255, 255, 0.15)'
                      : 'rgba(0, 0, 0, 0.1)'
                    : 'transparent',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                  WebkitAppRegion: 'no-drag'
                } as React.CSSProperties
              }
              onMouseEnter={(e) => {
                e.currentTarget.style.background = theme.isDark
                  ? 'rgba(255, 255, 255, 0.15)'
                  : 'rgba(0, 0, 0, 0.1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = showChat
                  ? theme.isDark
                    ? 'rgba(255, 255, 255, 0.15)'
                    : 'rgba(0, 0, 0, 0.1)'
                  : 'transparent'
              }}
            >
              <MessageCircle size={16} color={theme.text} />
            </button>
          </div>
        </div>

        {/* CSS animations */}
        <BrowserStyles />
    </div>
  )

  // Empty state — when all tabs are closed, show a "New Tab" placeholder
  // with recently visited websites instead of closing the window.
  const handleCreateTabFromEmptyState = useCallback((url?: string): void => {
    window.bridge.browser.createTab(url)
  }, [])

  if (tabs.length === 0) {
    const emptyState = (
      <BrowserEmptyState
        theme={theme}
        embedded={embedded}
        onCreateTab={handleCreateTabFromEmptyState}
      />
    )

    if (embedded) {
      return emptyState
    }

    return (
      <DockablePanel
        panelType="browser"
        panelBg={theme.surface}
        frameTransparent={!headerLocked && !isPanelHovered}
        extraWidth={extraWidth}
      >
        {emptyState}
      </DockablePanel>
    )
  }

  if (embedded) {
    return browserSurface
  }

  return (
    <DockablePanel
      panelType="browser"
      panelBg={theme.surface}
      frameTransparent={!headerLocked && !isPanelHovered}
      extraWidth={extraWidth}
    >
      {browserSurface}
    </DockablePanel>
  )
}
