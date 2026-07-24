import { useEffect, useCallback, RefObject } from 'react'
import { BrowserTab } from '../types'

interface UseBrowserKeyboardShortcutsProps {
  activeTabId: string | null
  activeTab: BrowserTab | undefined
  showFindBar: boolean
  showSettings: boolean
  showSiteInfo: boolean
  showChat: boolean
  originalUrl: string
  urlInputRef: RefObject<HTMLInputElement | null>
  setInputUrl: (url: string) => void
  setShowFindBar: (show: boolean) => void
  setShowSettings: (show: boolean) => void
  setIsSettingsTabOpen: (open: boolean) => void
  setSettingsTab: (
    tab: 'shortcuts' | 'history' | 'downloads' | 'bookmarks' | 'cookies' | 'permissions'
  ) => void
  goBack: () => void
  goForward: () => void
  createNewTab: () => void
  closeTab: (tabId: string) => void
  toggleSiteInfo: () => void
  toggleChat: () => void
}

export function useBrowserKeyboardShortcuts({
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
  toggleSiteInfo,
  toggleChat
}: UseBrowserKeyboardShortcutsProps): void {
  const handleShortcutFromMain = useCallback(
    (action: string, data?: number) => {
      switch (action) {
        case 'new-tab':
          window.bridge.browser.createTab()
          break
        case 'close-tab':
          if (activeTabId) {
            closeTab(activeTabId)
          }
          break
        case 'close-all':
          window.bridge.browser.closeAllTabs().then(() => {
            window.bridge.togglePanelWindow('browser', false)
          })
          break
        case 'reopen-tab':
          window.bridge.browser.reopenClosedTab()
          break
        case 'focus-omnibox':
          urlInputRef.current?.focus()
          urlInputRef.current?.select()
          break
        case 'reload':
          if (activeTabId) window.bridge.browser.reload(activeTabId)
          break
        case 'hard-reload':
          if (activeTabId) window.bridge.browser.hardReload(activeTabId)
          break
        case 'find':
          setShowFindBar(true)
          break
        case 'go-back':
          if (activeTabId && activeTab?.canGoBack) window.bridge.browser.goBack(activeTabId)
          break
        case 'go-forward':
          if (activeTabId && activeTab?.canGoForward) window.bridge.browser.goForward(activeTabId)
          break
        case 'prev-tab':
          window.bridge.browser.getPreviousTab().then((tabId) => {
            if (tabId) window.bridge.browser.switchTab(tabId)
          })
          break
        case 'next-tab':
          window.bridge.browser.getNextTab().then((tabId) => {
            if (tabId) window.bridge.browser.switchTab(tabId)
          })
          break
        case 'switch-tab':
          if (data !== undefined) {
            if (data === 9) {
              window.bridge.browser.getTabCount().then((count) => {
                if (count > 0) {
                  window.bridge.browser.getTabByIndex(count - 1).then((tabId) => {
                    if (tabId) window.bridge.browser.switchTab(tabId)
                  })
                }
              })
            } else {
              window.bridge.browser.getTabByIndex(data - 1).then((tabId) => {
                if (tabId) window.bridge.browser.switchTab(tabId)
              })
            }
          }
          break
        case 'settings':
          setSettingsTab('shortcuts')
          setShowSettings(true)
          setIsSettingsTabOpen(true)
          window.bridge.browser.hideAllTabs()
          break
        case 'escape':
          if (showFindBar) {
            setShowFindBar(false)
          } else if (showSettings) {
            setShowSettings(false)
            window.bridge.browser.showActiveTab()
          } else if (activeTab?.isLoading && activeTabId) {
            window.bridge.browser.stop(activeTabId)
          }
          break
      }
    },
    [
      activeTabId,
      activeTab,
      showFindBar,
      showSettings,
      urlInputRef,
      setShowFindBar,
      setShowSettings,
      setIsSettingsTabOpen,
      setSettingsTab,
      closeTab
    ]
  )

  useEffect(() => {
    const unsub = window.bridge.browser.onShortcut((action, data) => {
      handleShortcutFromMain(action, data)
    })
    return () => unsub()
  }, [handleShortcutFromMain])

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent): Promise<void> => {
      const isMeta = e.metaKey || e.ctrlKey

      if (e.key === 'Escape') {
        if (showFindBar) {
          setShowFindBar(false)
          return
        }
        if (showSettings) {
          setShowSettings(false)
          setIsSettingsTabOpen(false)
          return
        }
        if (document.activeElement === urlInputRef.current) {
          setInputUrl(originalUrl)
          urlInputRef.current?.blur()
          return
        }
        if (activeTabId && activeTab?.isLoading) {
          window.bridge.browser.stop(activeTabId)
        }
        return
      }

      if (!isMeta) return

      if (e.key === 'f') {
        e.preventDefault()
        setShowFindBar(true)
        return
      }

      if (e.key === 't' && !e.shiftKey) {
        e.preventDefault()
        createNewTab()
        return
      }

      if (e.key === 't' && e.shiftKey) {
        e.preventDefault()
        window.bridge.browser.reopenClosedTab()
        return
      }

      if (e.key === 'w') {
        e.preventDefault()
        if (activeTabId) closeTab(activeTabId)
        return
      }

      if (e.key === 'l') {
        e.preventDefault()
        urlInputRef.current?.focus()
        urlInputRef.current?.select()
        return
      }

      if (e.key === 'r' && !e.shiftKey) {
        e.preventDefault()
        if (activeTabId) window.bridge.browser.reload(activeTabId)
        return
      }

      if (e.key === 'r' && e.shiftKey) {
        e.preventDefault()
        if (activeTabId) window.bridge.browser.hardReload(activeTabId)
        return
      }

      if (e.key === '[' && !e.shiftKey) {
        e.preventDefault()
        goBack()
        return
      }

      if (e.key === ']' && !e.shiftKey) {
        e.preventDefault()
        goForward()
        return
      }

      if (e.key === '[' && e.shiftKey) {
        e.preventDefault()
        const prevTabId = await window.bridge.browser.getPreviousTab()
        if (prevTabId) window.bridge.browser.switchTab(prevTabId)
        return
      }

      if (e.key === ']' && e.shiftKey) {
        e.preventDefault()
        const nextTabId = await window.bridge.browser.getNextTab()
        if (nextTabId) window.bridge.browser.switchTab(nextTabId)
        return
      }

      if (e.key === '/' && e.shiftKey) {
        e.preventDefault()
        setSettingsTab('shortcuts')
        setShowSettings(true)
        setIsSettingsTabOpen(true)
        window.bridge.browser.hideAllTabs()
        return
      }

      if (e.key >= '1' && e.key <= '8') {
        e.preventDefault()
        const index = parseInt(e.key) - 1
        const tabId = await window.bridge.browser.getTabByIndex(index)
        if (tabId) window.bridge.browser.switchTab(tabId)
        return
      }

      if (e.key === '9') {
        e.preventDefault()
        const tabCount = await window.bridge.browser.getTabCount()
        if (tabCount > 0) {
          const tabId = await window.bridge.browser.getTabByIndex(tabCount - 1)
          if (tabId) window.bridge.browser.switchTab(tabId)
        }
        return
      }

      // Cmd+K: Toggle site info sidebar
      if (e.key === 'k' && !e.shiftKey) {
        e.preventDefault()
        toggleSiteInfo()
        return
      }

      // Cmd+Shift+C: Toggle chat
      if (e.key === 'c' && e.shiftKey) {
        e.preventDefault()
        toggleChat()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
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
    toggleSiteInfo,
    toggleChat
  ])
}
