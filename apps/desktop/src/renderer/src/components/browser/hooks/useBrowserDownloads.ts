import { useEffect } from 'react'
import { DownloadInfo } from '../types'

interface UseBrowserDownloadsProps {
  showDownloads: boolean
  showSettings: boolean
  settingsTab: string
  downloads: DownloadInfo[]
  setDownloads: React.Dispatch<React.SetStateAction<DownloadInfo[]>>
}

export function useBrowserDownloads({
  showDownloads,
  showSettings,
  settingsTab,
  setDownloads
}: UseBrowserDownloadsProps): void {
  useEffect(() => {
    if (showDownloads || (showSettings && settingsTab === 'downloads')) {
      window.bridge.browser.getDownloads().then((d) => setDownloads(d as DownloadInfo[]))
    }
  }, [showDownloads, showSettings, settingsTab, setDownloads])
}
