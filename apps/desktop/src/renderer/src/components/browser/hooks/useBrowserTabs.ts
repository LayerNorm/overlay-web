import { useState, useEffect, useCallback } from 'react'
import { BrowserTab, DownloadInfo } from '../types'
import { analytics } from '../../../services/analytics'

interface UseBrowserTabsReturn {
  tabs: BrowserTab[]
  activeTabId: string | null
  activeTab: BrowserTab | undefined
  setActiveTabId: (id: string | null) => void
  createNewTab: () => void
  closeTab: (tabId: string) => void
  switchTab: (tabId: string) => void
  setTabs: React.Dispatch<React.SetStateAction<BrowserTab[]>>
  reorderTabs: (fromIndex: number, toIndex: number) => void
  downloads: DownloadInfo[]
  setDownloads: React.Dispatch<React.SetStateAction<DownloadInfo[]>>
}

export function useBrowserTabs(): UseBrowserTabsReturn {
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<DownloadInfo[]>([])

  const activeTab = tabs.find((t) => t.id === activeTabId)

  useEffect(() => {
    const initTabs = async (): Promise<void> => {
      await window.bridge.browser.ensureWindow()
      const existingTabs = await window.bridge.browser.getTabs()
      if (existingTabs && existingTabs.length > 0) {
        setTabs(existingTabs as BrowserTab[])
        const activeId = await window.bridge.browser.getActiveTab()
        if (activeId) {
          setActiveTabId(activeId)
        }
      } else {
        window.bridge.browser.createTab('https://www.google.com')
      }
    }
    initTabs()
  }, [])

  useEffect(() => {
    const unsubCreated = window.bridge.browser.onTabCreated((tab) => {
      analytics.increment('browser_tabs_opened')
      setTabs((prev) => [
        ...prev,
        { ...tab, isLoading: true, canGoBack: false, canGoForward: false }
      ])
      setActiveTabId(tab.id)
    })

    const unsubUpdated = window.bridge.browser.onTabUpdated((tabId, changes) => {
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...changes } : t)))
    })

    const unsubClosed = window.bridge.browser.onTabClosed((tabId) => {
      setTabs((prev) => prev.filter((t) => t.id !== tabId))
    })

    const unsubActivated = window.bridge.browser.onTabActivated((tabId) => {
      setActiveTabId(tabId)
    })

    const unsubDownloadStarted = window.bridge.browser.onDownloadStarted((info) => {
      const dl = info as unknown as DownloadInfo
      setDownloads((prev) => [...prev, dl])
    })

    const unsubDownloadUpdated = window.bridge.browser.onDownloadUpdated((info) => {
      const dl = info as unknown as DownloadInfo
      setDownloads((prev) => prev.map((d) => (d.id === dl.id ? dl : d)))
    })

    const unsubDownloadCompleted = window.bridge.browser.onDownloadCompleted((info) => {
      const dl = info as unknown as DownloadInfo
      setDownloads((prev) => prev.map((d) => (d.id === dl.id ? dl : d)))
    })

    return () => {
      unsubCreated()
      unsubUpdated()
      unsubClosed()
      unsubActivated()
      unsubDownloadStarted()
      unsubDownloadUpdated()
      unsubDownloadCompleted()
    }
  }, [])

  const createNewTab = useCallback((): void => {
    window.bridge.browser.createTab()
  }, [])

  const closeTab = useCallback((tabId: string): void => {
    window.bridge.browser.closeTab(tabId)
  }, [])

  const switchTab = useCallback((tabId: string): void => {
    window.bridge.browser.switchTab(tabId)
  }, [])

  const reorderTabs = useCallback((fromIndex: number, toIndex: number): void => {
    setTabs((prev) => {
      const newTabs = [...prev]
      const [movedTab] = newTabs.splice(fromIndex, 1)
      newTabs.splice(toIndex, 0, movedTab)
      return newTabs
    })
  }, [])

  return {
    tabs,
    activeTabId,
    activeTab,
    setActiveTabId,
    createNewTab,
    closeTab,
    switchTab,
    setTabs,
    reorderTabs,
    downloads,
    setDownloads
  }
}
