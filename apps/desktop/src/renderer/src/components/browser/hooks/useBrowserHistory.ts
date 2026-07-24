import { useState, useEffect, useCallback } from 'react'
import { HistoryEntry } from '../types'

interface UseBrowserHistoryProps {
  showHistory: boolean
  showSettings: boolean
  settingsTab: string
  activeTabId: string | null
}

interface UseBrowserHistoryReturn {
  history: HistoryEntry[]
  setHistory: React.Dispatch<React.SetStateAction<HistoryEntry[]>>
  clearHistory: () => Promise<void>
  openHistoryUrl: (url: string, closeCallback?: () => void) => void
}

export function useBrowserHistory({
  showHistory,
  showSettings,
  settingsTab,
  activeTabId
}: UseBrowserHistoryProps): UseBrowserHistoryReturn {
  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    if (showHistory || (showSettings && settingsTab === 'history')) {
      window.bridge.browser.getHistory().then((h) => setHistory(h as HistoryEntry[]))
    }
  }, [showHistory, showSettings, settingsTab])

  const clearHistory = useCallback(async (): Promise<void> => {
    await window.bridge.browser.clearHistory()
    setHistory([])
  }, [])

  const openHistoryUrl = useCallback(
    (url: string, closeCallback?: () => void): void => {
      if (activeTabId) {
        window.bridge.browser.navigate(activeTabId, url)
        closeCallback?.()
      }
    },
    [activeTabId]
  )

  return {
    history,
    setHistory,
    clearHistory,
    openHistoryUrl
  }
}
