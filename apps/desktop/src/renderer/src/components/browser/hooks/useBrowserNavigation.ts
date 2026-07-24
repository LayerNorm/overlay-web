import { useCallback } from 'react'
import { BrowserTab } from '../types'

interface UseBrowserNavigationProps {
  activeTabId: string | null
  activeTab: BrowserTab | undefined
}

interface UseBrowserNavigationReturn {
  goBack: () => void
  goForward: () => void
  reload: () => void
  goHome: () => void
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export function useBrowserNavigation({
  activeTabId,
  activeTab
}: UseBrowserNavigationProps): UseBrowserNavigationReturn {
  const isLoading = activeTab?.isLoading ?? false
  const canGoBack = activeTab?.canGoBack ?? false
  const canGoForward = activeTab?.canGoForward ?? false

  const goBack = useCallback((): void => {
    if (activeTabId) window.bridge.browser.goBack(activeTabId)
  }, [activeTabId])

  const goForward = useCallback((): void => {
    if (activeTabId) window.bridge.browser.goForward(activeTabId)
  }, [activeTabId])

  const reload = useCallback((): void => {
    if (!activeTabId) return
    if (activeTab?.isLoading) {
      window.bridge.browser.stop(activeTabId)
    } else {
      window.bridge.browser.reload(activeTabId)
    }
  }, [activeTabId, activeTab?.isLoading])

  const goHome = useCallback((): void => {
    if (activeTabId) window.bridge.browser.navigate(activeTabId, 'https://www.google.com')
  }, [activeTabId])

  return {
    goBack,
    goForward,
    reload,
    goHome,
    isLoading,
    canGoBack,
    canGoForward
  }
}
