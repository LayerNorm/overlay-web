import type { Metadata } from 'next'
import { DesktopDownloadPage } from '@/features/marketing/pages/DesktopDownloadPage'
import { areOfficialDesktopDownloadsEnabled } from '@/server/releases/desktop-download-policy'
import {
  fetchLatestReleaseInfo,
  type LatestReleaseInfo,
} from '@/shared/web/latest-release'

export const metadata: Metadata = {
  title: 'Download Overlay for macOS',
  description:
    'Download Overlay Desktop for macOS Apple Silicon, or build from the public source repository.',
}

export const dynamic = 'force-dynamic'

export default async function DownloadRoutePage() {
  const downloadsEnabled = areOfficialDesktopDownloadsEnabled()

  let release: LatestReleaseInfo | null = null
  let releaseError: string | null = null

  if (downloadsEnabled) {
    try {
      release = await fetchLatestReleaseInfo()
    } catch (error) {
      releaseError = error instanceof Error ? error.message : 'unknown error'
    }
  }

  return (
    <DesktopDownloadPage
      downloadsEnabled={downloadsEnabled}
      release={release}
      releaseError={releaseError}
    />
  )
}
