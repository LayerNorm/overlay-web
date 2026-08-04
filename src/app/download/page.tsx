import { Suspense } from 'react'
import type { Metadata } from 'next'
import { DesktopDownloadPage } from '@/features/marketing/pages/DesktopDownloadPage'
import { areOfficialDesktopDownloadsEnabled } from '@/server/releases/desktop-download-policy'
import {
  fetchLatestReleaseInfo,
  type LatestReleaseInfo,
} from '@/shared/web/latest-release'
import { LandingThemeProvider } from '@/contexts/LandingThemeContext'

export const metadata: Metadata = {
  title: 'Download Overlay for macOS',
  description:
    'Download Overlay Desktop for macOS Apple Silicon, or build from the public source repository.',
}

function DownloadFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <p role="status" className="text-sm text-[var(--muted)]">
        Loading download…
      </p>
    </div>
  )
}

async function DownloadContent() {
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

export default function DownloadRoutePage() {
  return (
    <LandingThemeProvider>
      <Suspense fallback={<DownloadFallback />}>
        <DownloadContent />
      </Suspense>
    </LandingThemeProvider>
  )
}
