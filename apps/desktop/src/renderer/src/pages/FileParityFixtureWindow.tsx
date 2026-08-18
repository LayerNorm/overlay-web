import {
  FILE_PARITY_FIXTURE_VERSION,
  createFileParityInstrumentation,
  type FileParityCounterSnapshot
} from '@overlay/app-core/file-parity-fixtures'
import {
  FileParityFixtureSurface,
  type FileParityFixtureScenario
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

const SCENARIOS = new Set<FileParityFixtureScenario>([
  'gallery', 'states', 'inventory', 'viewers', 'notebook', 'sync', 'surface'
])

export function FileParityFixtureWindow(): React.ReactElement<any> {
  const params = new URLSearchParams(window.location.search)
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
  const requestedWidth = Number(params.get('width'))
  const width = [1024, 1280, 1440].includes(requestedWidth) ? requestedWidth : 1280
  const requestedScenario = params.get('scenario') as FileParityFixtureScenario | null
  const scenario = requestedScenario && SCENARIOS.has(requestedScenario) ? requestedScenario : 'gallery'
  const instrumentation = useMemo(() => createFileParityInstrumentation(), [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    return () => { delete document.documentElement.dataset.theme }
  }, [theme])

  const handleReady = useCallback(() => {
    window.__FILE_PARITY_BASELINE__ = { fixtureVersion: FILE_PARITY_FIXTURE_VERSION, platform: 'desktop', scenario, theme, width, counters: instrumentation.snapshot() }
    document.documentElement.dataset.fileParityReady = 'true'
  }, [instrumentation, scenario, theme, width])

  return (
    <main className="file-parity-page" data-theme={theme}>
      <div className="file-parity-page__content" style={{ maxWidth: width }}>
        <header className="file-parity-page__header"><div><p>Electron fixture mode</p><h1>Files and notebook parity</h1></div><code>{FILE_PARITY_FIXTURE_VERSION} · {scenario} · {width}px</code></header>
        <FileParityFixtureSurface platform="desktop" scenario={scenario} instrumentation={instrumentation} onReady={handleReady} />
      </div>
    </main>
  )
}
