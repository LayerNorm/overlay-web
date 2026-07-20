'use client'

import {
  FILE_PARITY_FIXTURE_VERSION,
  createFileParityInstrumentation,
  type FileParityCounterSnapshot,
} from '@overlay/app-core/file-parity-fixtures'
import {
  FileParityFixtureSurface,
  type FileParityFixtureScenario,
} from '@overlay/modules-react/file-parity-fixture'
import { useCallback, useEffect, useMemo } from 'react'

declare global {
  interface Window {
    __FILE_PARITY_BASELINE__?: {
      fixtureVersion: string
      platform: 'web' | 'desktop'
      scenario: string
      theme: 'light' | 'dark'
      width: number
      counters: FileParityCounterSnapshot
    }
  }
}

export function FileParityHarness({ theme, scenario, width }: { theme: 'light' | 'dark'; scenario: FileParityFixtureScenario; width: number }) {
  const instrumentation = useMemo(() => createFileParityInstrumentation(), [])

  useEffect(() => {
    const previousTheme = document.documentElement.dataset.theme
    document.documentElement.dataset.theme = theme
    document.body.dataset.fileParityFixture = 'true'
    return () => {
      if (previousTheme) document.documentElement.dataset.theme = previousTheme
      else delete document.documentElement.dataset.theme
      delete document.body.dataset.fileParityFixture
    }
  }, [theme])

  const handleReady = useCallback(() => {
    window.__FILE_PARITY_BASELINE__ = { fixtureVersion: FILE_PARITY_FIXTURE_VERSION, platform: 'web', scenario, theme, width, counters: instrumentation.snapshot() }
    document.documentElement.dataset.fileParityReady = 'true'
  }, [instrumentation, scenario, theme, width])

  return (
    <main className="file-parity-page" data-theme={theme}>
      <div className="file-parity-page__content" style={{ maxWidth: width }}>
        <header className="file-parity-page__header"><div><p>Web fixture harness</p><h1>Files and notebook parity</h1></div><code>{FILE_PARITY_FIXTURE_VERSION} · {scenario} · {width}px</code></header>
        <FileParityFixtureSurface platform="web" scenario={scenario} instrumentation={instrumentation} onReady={handleReady} />
      </div>
    </main>
  )
}
