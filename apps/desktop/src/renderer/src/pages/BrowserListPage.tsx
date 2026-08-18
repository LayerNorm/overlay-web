import { useState, useEffect, useCallback, useMemo } from 'react'
import { Globe, X, ExternalLink, Trash2 } from 'lucide-react'
import type { Theme } from '../utils/theme'
import type { BrowserTab } from '../components/browser/types'
import { SidebarListItem, SidebarItemAction } from '../components/ui/SidebarListItem'

interface BrowserListPageProps {
  theme: Theme
  openBehavior?: 'embedded' | 'panel'
  selectedTabId?: string | null
  isSearchOpen: boolean
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  isSelectMode: boolean
  onSelectModeChange: (value: boolean) => void
}

function truncateUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname + (u.pathname !== '/' ? u.pathname : '')
  } catch {
    return url
  }
}

export function BrowserListPage({
  theme,
  openBehavior = 'panel',
  selectedTabId,
  isSearchOpen,
  searchQuery,
  onSearchQueryChange,
  isSelectMode,
  onSelectModeChange
}: BrowserListPageProps): React.ReactElement<any> {
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    void (async (): Promise<void> => {
      if (openBehavior === 'embedded') await window.bridge.browser.ensureWindow()
      const existingTabs = await window.bridge.browser.getTabs()
      if (existingTabs && existingTabs.length > 0) {
        setTabs(existingTabs as BrowserTab[])
        const activeId = await window.bridge.browser.getActiveTab()
        if (activeId) setActiveTabId(activeId as string)
      }
    })()
  }, [openBehavior])

  useEffect(() => {
    const unsubCreated = window.bridge.browser.onTabCreated((tab) => {
      setTabs((prev) => [
        ...prev,
        { ...tab, isLoading: true, canGoBack: false, canGoForward: false } as BrowserTab
      ])
      setActiveTabId(tab.id)
    })
    const unsubUpdated = window.bridge.browser.onTabUpdated((tabId, changes) => {
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...changes } : t)))
    })
    const unsubClosed = window.bridge.browser.onTabClosed((tabId) => {
      setTabs((prev) => prev.filter((t) => t.id !== tabId))
      setSelectedTabIds((prev) => {
        const next = new Set(prev)
        next.delete(tabId)
        return next
      })
    })
    const unsubActivated = window.bridge.browser.onTabActivated((tabId) => {
      setActiveTabId(tabId)
    })
    return (): void => {
      unsubCreated()
      unsubUpdated()
      unsubClosed()
      unsubActivated()
    }
  }, [])

  useEffect(() => {
    if (!isSelectMode) setSelectedTabIds(new Set())
  }, [isSelectMode])

  const handleSelectTab = useCallback(
    (tab: BrowserTab): void => {
      if (isSelectMode) {
        setSelectedTabIds((prev) => {
          const next = new Set(prev)
          if (next.has(tab.id)) next.delete(tab.id)
          else next.add(tab.id)
          return next
        })
        return
      }

      window.bridge.browser.switchTab(tab.id)
      if (openBehavior === 'panel') {
        void window.bridge.isPanelVisible('browser').then(({ isVisible }) => {
          if (!isVisible) void window.bridge.togglePanelWindow('browser', true)
        })
      }
    },
    [isSelectMode, openBehavior]
  )

  const handleOpenInPanel = useCallback(async (tabId: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    window.bridge.browser.switchTab(tabId)
    const { isVisible } = await window.bridge.isPanelVisible('browser')
    if (!isVisible) await window.bridge.togglePanelWindow('browser', true)
  }, [])

  const handleCloseTab = useCallback((tabId: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    window.bridge.browser.closeTab(tabId)
  }, [])

  const exitSelectMode = useCallback(() => {
    onSelectModeChange(false)
    setSelectedTabIds(new Set())
  }, [onSelectModeChange])

  const handleBatchClose = useCallback(() => {
    for (const tabId of selectedTabIds) window.bridge.browser.closeTab(tabId)
    exitSelectMode()
  }, [exitSelectMode, selectedTabIds])

  const filteredTabs = useMemo(() => {
    if (!searchQuery.trim()) return tabs
    const q = searchQuery.toLowerCase()
    return tabs.filter((t) => (t.title || '').toLowerCase().includes(q) || t.url.toLowerCase().includes(q))
  }, [tabs, searchQuery])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {isSearchOpen && (
        <div style={{ padding: '6px 8px', flexShrink: 0 }}>
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search tabs..."
            style={{
              width: '100%',
              padding: '5px 10px',
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
              color: theme.text,
              fontSize: '12px',
              outline: 'none',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              boxSizing: 'border-box'
            }}
          />
        </div>
      )}

      {isSelectMode && selectedTabIds.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 8px',
            flexShrink: 0
          }}
        >
          <span style={{ fontSize: '11px', color: theme.textSecondary }}>
            {selectedTabIds.size} selected
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={handleBatchClose}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                padding: '3px 8px',
                background: 'transparent',
                border: '1px solid rgba(239,68,68,0.35)',
                borderRadius: '5px',
                color: 'rgb(239,68,68)',
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              <Trash2 size={11} /> Close
            </button>
            <button
              onClick={exitSelectMode}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '3px 6px',
                background: 'transparent',
                border: `1px solid ${theme.border}`,
                borderRadius: '5px',
                color: theme.textSecondary,
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 8px 4px' }}>
        {filteredTabs.length === 0 ? (
          <div>
            <div
              style={{
                fontSize: '10px',
                color: theme.textSecondary,
                padding: '4px 10px 2px',
                opacity: 0.5,
                letterSpacing: '0.3px'
              }}
            >
              {searchQuery ? 'No results' : 'Open tabs'}
            </div>
            {!searchQuery && (
              <SidebarListItem
                icon={Globe}
                label="New Tab"
                isActive
                onClick={() => window.bridge.browser.createTab()}
                theme={theme}
              />
            )}
          </div>
        ) : (
          <div>
            <div
              style={{
                fontSize: '10px',
                color: theme.textSecondary,
                padding: '4px 10px 2px',
                opacity: 0.5,
                letterSpacing: '0.3px'
              }}
            >
              Open tabs
            </div>
            {filteredTabs.map((tab) => {
              const isActive = activeTabId === tab.id || selectedTabId === tab.id
              const isBatchSelected = selectedTabIds.has(tab.id)
              return (
                <SidebarListItem
                  key={tab.id}
                  icon={Globe}
                  label={tab.title || truncateUrl(tab.url) || 'New Tab'}
                  isActive={isActive}
                  isSelectMode={isSelectMode}
                  isBatchSelected={isBatchSelected}
                  onBatchToggle={() => {
                    setSelectedTabIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(tab.id)) next.delete(tab.id)
                      else next.add(tab.id)
                      return next
                    })
                  }}
                  onClick={() => handleSelectTab(tab)}
                  theme={theme}
                  actions={
                    <>
                      <SidebarItemAction
                        onClick={(e) => void handleOpenInPanel(tab.id, e)}
                        title="Open in panel"
                        icon={ExternalLink}
                        color={theme.textSecondary}
                      />
                      <SidebarItemAction
                        onClick={(e) => handleCloseTab(tab.id, e)}
                        title="Close tab"
                        icon={X}
                        color={theme.textSecondary}
                      />
                    </>
                  }
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
