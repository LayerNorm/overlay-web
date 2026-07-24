import { useState, useEffect, useCallback } from 'react'
import { SidebarType, SiteInfoView } from '../types'

interface UseSidebarStateReturn {
  showHistory: boolean
  showDownloads: boolean
  showBookmarks: boolean
  showSiteInfo: boolean
  siteInfoView: SiteInfoView
  activeSidebar: SidebarType
  setShowHistory: React.Dispatch<React.SetStateAction<boolean>>
  setShowDownloads: React.Dispatch<React.SetStateAction<boolean>>
  setShowBookmarks: React.Dispatch<React.SetStateAction<boolean>>
  setShowSiteInfo: React.Dispatch<React.SetStateAction<boolean>>
  setSiteInfoView: React.Dispatch<React.SetStateAction<SiteInfoView>>
  closeSidebar: () => void
  toggleHistory: () => void
  toggleDownloads: () => void
  toggleBookmarks: () => void
}

export function useSidebarState(): UseSidebarStateReturn {
  const [showHistory, setShowHistory] = useState(false)
  const [showDownloads, setShowDownloads] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [showSiteInfo, setShowSiteInfo] = useState(false)
  const [siteInfoView, setSiteInfoView] = useState<SiteInfoView>('main')

  const activeSidebar: SidebarType = showHistory
    ? 'history'
    : showDownloads
      ? 'downloads'
      : showBookmarks
        ? 'bookmarks'
        : showSiteInfo
          ? 'siteinfo'
          : null

  useEffect(() => {
    const sidePanelWidth = showHistory || showDownloads || showBookmarks ? 280 : 0
    window.bridge.browser.setSidePanelWidth(sidePanelWidth)
  }, [showHistory, showDownloads, showBookmarks])

  useEffect(() => {
    const leftPanelWidth = showSiteInfo ? 280 : 0
    window.bridge.browser.setLeftPanelWidth(leftPanelWidth)
  }, [showSiteInfo])

  const closeSidebar = useCallback((): void => {
    setShowHistory(false)
    setShowDownloads(false)
    setShowBookmarks(false)
    setShowSiteInfo(false)
  }, [])

  const toggleHistory = useCallback((): void => {
    setShowHistory((prev) => {
      if (!prev) {
        setShowDownloads(false)
        setShowBookmarks(false)
        setShowSiteInfo(false)
      }
      return !prev
    })
  }, [])

  const toggleDownloads = useCallback((): void => {
    setShowDownloads((prev) => {
      if (!prev) {
        setShowHistory(false)
        setShowBookmarks(false)
        setShowSiteInfo(false)
      }
      return !prev
    })
  }, [])

  const toggleBookmarks = useCallback((): void => {
    setShowBookmarks((prev) => {
      if (!prev) {
        setShowHistory(false)
        setShowDownloads(false)
        setShowSiteInfo(false)
      }
      return !prev
    })
  }, [])

  return {
    showHistory,
    showDownloads,
    showBookmarks,
    showSiteInfo,
    siteInfoView,
    activeSidebar,
    setShowHistory,
    setShowDownloads,
    setShowBookmarks,
    setShowSiteInfo,
    setSiteInfoView,
    closeSidebar,
    toggleHistory,
    toggleDownloads,
    toggleBookmarks
  }
}
