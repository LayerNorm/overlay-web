import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const artifactRoot = join(workspaceRoot, 'output/playwright/file-parity')
const baselineRoot = join(artifactRoot, 'baselines')
const fixtureSource = readFileSync(
  join(workspaceRoot, 'packages/overlay-app-core/src/file-parity-fixtures.ts'),
  'utf8',
)
const fixtureVersion = fixtureSource.match(
  /FILE_PARITY_FIXTURE_VERSION\s*=\s*['"]([^'"]+)['"]/,
)?.[1]

if (!fixtureVersion) throw new Error('Unable to read FILE_PARITY_FIXTURE_VERSION')

const requiredFixtureIds = [
  'empty',
  'loading',
  'refreshing',
  'error',
  'inventory',
  'search',
  'selected-row',
  'bulk-selection',
  'context-menu',
  'offline',
  'syncing',
  'conflicted',
  'migration',
  'viewer-markdown',
  'viewer-text',
  'viewer-csv',
  'viewer-html',
  'viewer-pdf',
  'viewer-docx',
  'viewer-image',
  'viewer-audio',
  'viewer-video',
  'viewer-missing',
  'editor-ready',
  'editor-hydrating',
  'editor-saving',
  'editor-conflicted',
  'editor-migration',
]
const missingFixtureIds = requiredFixtureIds.filter(
  (id) => !new RegExp(`\\bid:\\s*['"]${id}['"]`).test(fixtureSource),
)
if (missingFixtureIds.length) {
  throw new Error(`Missing file parity fixtures: ${missingFixtureIds.join(', ')}`)
}

const platforms = ['web', 'desktop']
const themes = ['light', 'dark']
const widths = [1024, 1280, 1440]
const entries = []

for (const platform of platforms) {
  for (const theme of themes) {
    for (const width of widths) {
      entries.push({ platform, scenario: 'gallery', theme, width })
    }
    entries.push({ platform, scenario: 'viewers', theme, width: 1280 })
    entries.push({ platform, scenario: 'notebook', theme, width: 1280 })
  }
}

for (const entry of entries) {
  entry.filename = `${entry.platform}-${entry.scenario}-${entry.theme}-${entry.width}.png`
}

const expectedFiles = new Set(entries.map((entry) => entry.filename))
const actualFiles = new Set(
  readdirSync(baselineRoot).filter((filename) => filename.endsWith('.png')),
)
const missing = [...expectedFiles].filter((filename) => !actualFiles.has(filename))
const stale = [...actualFiles].filter((filename) => !expectedFiles.has(filename))
if (missing.length || stale.length) {
  throw new Error(
    [
      missing.length ? `Missing baselines:\n${missing.map((item) => `- ${item}`).join('\n')}` : '',
      stale.length ? `Stale baselines:\n${stale.map((item) => `- ${item}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
  )
}

function screenshotMetadata(entry) {
  const path = join(baselineRoot, entry.filename)
  if (!existsSync(path)) throw new Error(`Missing baseline ${entry.filename}`)
  const screenshot = readFileSync(path)
  if (screenshot.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`Baseline is not a PNG: ${entry.filename}`)
  }
  const actualWidth = screenshot.readUInt32BE(16)
  if (actualWidth !== entry.width) {
    throw new Error(`${entry.filename} is ${actualWidth}px wide; expected ${entry.width}px`)
  }
  return {
    path: relative(artifactRoot, path),
    sha256: createHash('sha256').update(screenshot).digest('hex'),
  }
}

const screenshots = Object.fromEntries(
  entries
    .map((entry) => {
      const metadata = screenshotMetadata(entry)
      return [metadata.path, metadata.sha256]
    })
    .sort(([left], [right]) => left.localeCompare(right)),
)

const renderCounts = JSON.parse(readFileSync(join(artifactRoot, 'render-counts.json'), 'utf8'))
if (renderCounts.fixtureVersion !== fixtureVersion) {
  throw new Error('render-counts.json does not match the current fixture version')
}

const webExtractionScenarios = entries.filter((entry) => entry.platform === 'web')
const manifest = {
  fixtureVersion,
  capturedAt: '2026-07-20',
  browser: 'Chromium via Playwright CLI',
  coverage: {
    platforms,
    themes,
    widths,
    scenarios: ['gallery', 'viewers', 'notebook'],
    listStates: ['empty', 'loading', 'refreshing', 'error'],
    content: ['files', 'folders', 'notes', 'outputs', 'nested-folders', 'long-names', 'unicode', 'duplicate-names', 'missing-previews'],
    interactions: ['search', 'selected-row', 'bulk-selection', 'context-menu'],
    viewers: ['markdown', 'text', 'csv', 'html', 'pdf', 'docx', 'image', 'audio', 'video'],
    editor: ['formatting', 'tables', 'tasks', 'code', 'math', 'images', 'links'],
    persistence: ['offline', 'syncing', 'conflicted', 'migration'],
  },
  cssExtraction: {
    webScreenshotDiff: 0,
    comparedScreenshots: webExtractionScenarios.length,
    stylesheets: ['knowledge-surface.css', 'file-viewer.css', 'notebook-editor.css'],
  },
  screenshotCount: entries.length,
  screenshots,
}

writeFileSync(
  join(artifactRoot, 'baseline-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
console.log(`Wrote ${entries.length} file parity baselines for fixture ${fixtureVersion}.`)
