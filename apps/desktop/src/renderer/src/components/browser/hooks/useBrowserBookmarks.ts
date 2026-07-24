import { useState, useEffect, useCallback } from 'react'
import { BookmarkEntry, BrowserTab } from '../types'

interface UseBrowserBookmarksProps {
  showBookmarks: boolean
  showSettings: boolean
  settingsTab: string
  activeTab: BrowserTab | undefined
  activeTabId: string | null
}

interface UseBrowserBookmarksReturn {
  bookmarks: BookmarkEntry[]
  setBookmarks: React.Dispatch<React.SetStateAction<BookmarkEntry[]>>
  addBookmark: () => void
  removeBookmark: (id: string) => void
  toggleBookmark: () => void
  openBookmarkUrl: (url: string, closeCallback?: () => void) => void
  isCurrentPageBookmarked: boolean
}

const STORAGE_KEY = 'browser-bookmarks'

export function useBrowserBookmarks({
  showBookmarks,
  showSettings,
  settingsTab,
  activeTab,
  activeTabId
}: UseBrowserBookmarksProps): UseBrowserBookmarksReturn {
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([])

  useEffect(() => {
    if (showBookmarks || (showSettings && settingsTab === 'bookmarks')) {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        setBookmarks(JSON.parse(stored))
      }
    }
  }, [showBookmarks, showSettings, settingsTab])

  const addBookmark = useCallback((): void => {
    if (!activeTab || !activeTab.url) return
    const newBookmark: BookmarkEntry = {
      id: Date.now().toString(),
      url: activeTab.url,
      title: activeTab.title || activeTab.url,
      createdAt: Date.now()
    }
    setBookmarks((prev) => {
      const updated = [newBookmark, ...prev.filter((b) => b.url !== activeTab.url)]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }, [activeTab])

  const removeBookmark = useCallback((id: string): void => {
    setBookmarks((prev) => {
      const updated = prev.filter((b) => b.id !== id)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }, [])

  const openBookmarkUrl = useCallback(
    (url: string, closeCallback?: () => void): void => {
      if (activeTabId) {
        window.bridge.browser.navigate(activeTabId, url)
        closeCallback?.()
      }
    },
    [activeTabId]
  )

  const isCurrentPageBookmarked = bookmarks.some((b) => b.url === activeTab?.url)

  const toggleBookmark = useCallback((): void => {
    if (!activeTab || !activeTab.url) return
    const existingBookmark = bookmarks.find((b) => b.url === activeTab.url)
    if (existingBookmark) {
      removeBookmark(existingBookmark.id)
    } else {
      addBookmark()
    }
  }, [activeTab, bookmarks, addBookmark, removeBookmark])

  return {
    bookmarks,
    setBookmarks,
    addBookmark,
    removeBookmark,
    toggleBookmark,
    openBookmarkUrl,
    isCurrentPageBookmarked
  }
}
