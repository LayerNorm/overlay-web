import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const artifactRoot = join(workspaceRoot, 'output/playwright/chat-parity')
const baselineRoot = join(artifactRoot, 'baselines')
const fixtureSource = readFileSync(
  join(workspaceRoot, 'packages/overlay-chat-core/src/parity-fixtures.ts'),
  'utf8'
)
const fixtureVersion = fixtureSource.match(
  /CHAT_PARITY_FIXTURE_VERSION\s*=\s*["']([^"']+)["']/
)?.[1]

if (!fixtureVersion) throw new Error('Unable to read CHAT_PARITY_FIXTURE_VERSION')

const requiredFixtureIds = [
  'rich-markdown',
  'multi-model-text',
  'reasoning-tools',
  'loading',
  'streaming',
  'error-interrupted',
  'image-complete',
  'image-generating',
  'video-complete',
  'video-failed'
]
const missingFixtureIds = requiredFixtureIds.filter(
  (id) => !new RegExp(`\\bid:\\s*["']${id}["']`).test(fixtureSource)
)
if (missingFixtureIds.length) {
  throw new Error(`Missing required parity fixtures: ${missingFixtureIds.join(', ')}`)
}

const platforms = ['web', 'desktop']
const themes = ['light', 'dark']
const widths = [390, 640, 896]
const interactions = ['default', 'hover', 'focus']
const entries = []

for (const platform of platforms) {
  for (const theme of themes) {
    for (const width of widths) {
      entries.push({
        platform,
        suite: 'gallery',
        scenario: 'gallery',
        theme,
        width,
        interaction: 'default',
        motion: 'normal',
        filename: `${platform}-gallery-${theme}-${width}.png`
      })
      for (const interaction of interactions) {
        entries.push({
          platform,
          suite: 'actions',
          scenario: 'rich-markdown',
          theme,
          width,
          interaction,
          motion: 'normal',
          filename: `${platform}-rich-markdown-${theme}-${width}${
            interaction === 'default' ? '' : `-${interaction}`
          }.png`
        })
      }
      entries.push({
        platform,
        suite: 'reduced-motion',
        scenario: 'streaming',
        theme,
        width,
        interaction: 'default',
        motion: 'reduced',
        filename: `${platform}-streaming-${theme}-${width}-reduced-motion.png`
      })
    }
  }
}

for (const theme of themes) {
  for (const width of widths) {
    entries.push({
      platform: 'desktop',
      suite: 'embedded-consumers',
      scenario: 'embedded-consumers',
      theme,
      width,
      interaction: 'default',
      motion: 'normal',
      filename: `desktop-embedded-consumers-${theme}-${width}.png`
    })
  }
}

const expectedFiles = new Set(entries.map((entry) => entry.filename))
const actualFiles = new Set(
  readdirSync(baselineRoot).filter((filename) => filename.endsWith('.png'))
)
const missing = [...expectedFiles].filter((filename) => !actualFiles.has(filename))
const stale = [...actualFiles].filter((filename) => !expectedFiles.has(filename))
if (missing.length || stale.length) {
  throw new Error(
    [
      missing.length ? `Missing baselines:\n${missing.map((item) => `- ${item}`).join('\n')}` : '',
      stale.length ? `Stale baselines:\n${stale.map((item) => `- ${item}`).join('\n')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  )
}

const screenshots = Object.fromEntries(
  entries
    .map((entry) => {
      const path = join(baselineRoot, entry.filename)
      if (!existsSync(path)) throw new Error(`Missing baseline ${entry.filename}`)
      const screenshot = readFileSync(path)
      if (screenshot.toString('ascii', 1, 4) !== 'PNG') {
        throw new Error(`Baseline is not a PNG: ${entry.filename}`)
      }
      const actualWidth = screenshot.readUInt32BE(16)
      if (actualWidth !== entry.width) {
        throw new Error(
          `Baseline ${entry.filename} is ${actualWidth}px wide; expected ${entry.width}px`
        )
      }
      return [
        relative(artifactRoot, path),
        createHash('sha256').update(screenshot).digest('hex')
      ]
    })
    .sort(([left], [right]) => left.localeCompare(right))
)

const manifest = {
  fixtureVersion,
  capturedAt: '2026-07-17',
  browser: 'Chromium via Playwright CLI',
  coverage: {
    platforms,
    themes,
    widths,
    interactions,
    motion: ['normal', 'reduced'],
    runtime: ['loading', 'streaming', 'executing-tool', 'interrupted', 'error', 'completed'],
    content: [
      'rich-markdown',
      'reasoning',
      'tools',
      'generated-ui',
      'multi-model',
      'image',
      'video',
      'embedded-browser',
      'embedded-notebook'
    ]
  },
  suites: {
    gallery: {
      platforms,
      themes,
      widths,
      interaction: 'default',
      motion: 'normal',
      covers: 'runtime and content states'
    },
    actions: {
      platforms,
      themes,
      widths,
      interactions,
      motion: 'normal'
    },
    'reduced-motion': {
      platforms,
      themes,
      widths,
      interaction: 'default',
      motion: 'reduced',
      scenario: 'streaming'
    },
    'embedded-consumers': {
      platforms: ['desktop'],
      themes,
      widths,
      interaction: 'default',
      motion: 'normal'
    }
  },
  screenshotCount: entries.length,
  screenshots
}

writeFileSync(
  join(artifactRoot, 'baseline-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
)
console.log(`Wrote ${entries.length} chat parity baselines for fixture ${fixtureVersion}.`)
