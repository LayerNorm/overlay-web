#!/usr/bin/env node
// Keeps the Convex-native architecture from quietly regressing (CN-37).
//
// 1. Removed layers stay removed: the database-provider capability switch and the
//    HS256 browser token may not come back under their old names.
// 2. Browser HTTP calls only shrink: every `overlayAppClient.<resource>.<method>`
//    call in browser code is listed in a baseline. Reads and ordinary writes belong
//    in native Convex queries and mutations; a new call fails until it is either
//    made native or added to the baseline on purpose (server work such as model
//    runs, billing, OAuth, email or file bytes). A call that disappears must be
//    removed from the baseline too, so the list never hides dead entries.
//
//   node scripts/ci/check-native-architecture.mjs           # check
//   node scripts/ci/check-native-architecture.mjs --update  # rewrite the baseline
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const BASELINE_PATH = 'scripts/baselines/browser-http-calls.json'

export const BANNED_IDENTIFIERS = [
  { name: 'AppDataCapabilities', message: 'Convex is the only backend; there is no app-data provider capability set.' },
  { name: 'appDataCapabilities', message: 'Convex is the only backend; there is no app-data provider capability set.' },
  { name: 'deriveAppDataCapabilities', message: 'Convex is the only backend; there is no app-data provider capability set.' },
  { name: 'selectedDatabaseProvider', message: 'Convex is the only backend; do not add a database-provider switch.' },
  { name: 'unsupportedRepository', message: 'Do not add placeholder repositories for other databases.' },
  { name: 'repositoryProxy', message: 'Construct the Convex repository directly, or use lazyService for server-context services.' },
  { name: 'mintBrowserConvexAccessToken', message: 'Browser Convex access uses native auth only (ConvexProviderWithAuth).' },
  { name: 'verifyBrowserConvexAccessToken', message: 'Browser Convex access uses native auth only (ConvexProviderWithAuth).' },
  { name: 'useConvexAuthToken', message: 'Browser Convex access uses native auth only; never pass a token as a query argument.' },
  { name: 'overlay-browser-convex', message: 'The HS256 browser token issuer was retired; Convex rejects these tokens.' },
]

const SOURCE_FILE = /\.(c|m)?[jt]sx?$/
const TEST_FILE = /\.test\.(c|m)?[jt]sx?$/
const BROWSER_ROOTS = ['src/features/', 'src/components/', 'src/app/', 'src/contexts/', 'src/hooks/']
const CLIENT_CALL = /\boverlayAppClient\s*\.\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g

export function findBannedIdentifiers(source) {
  const findings = []
  const lineOf = (index) => source.slice(0, index).split('\n').length
  for (const { name, message } of BANNED_IDENTIFIERS) {
    const pattern = name.includes('-') ? new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : new RegExp(`\\b${name}\\b`, 'g')
    for (const match of source.matchAll(pattern)) findings.push({ line: lineOf(match.index), name, message })
  }
  return findings
}

export function isBrowserFile(file) {
  if (!SOURCE_FILE.test(file) || TEST_FILE.test(file)) return false
  if (file.startsWith('src/app/api/')) return false
  return BROWSER_ROOTS.some((root) => file.startsWith(root))
}

export function findBrowserHttpCalls(source) {
  const calls = new Set()
  for (const match of source.matchAll(CLIENT_CALL)) calls.add(`${match[1]}.${match[2]}`)
  return calls
}

/** Compares current calls (call -> files) with the baseline (call -> files). */
export function compareWithBaseline(current, baseline) {
  const added = []
  const stale = []
  for (const [call, files] of Object.entries(current)) {
    const allowed = new Set(baseline[call] ?? [])
    for (const file of files) if (!allowed.has(file)) added.push(`${file}: overlayAppClient.${call}`)
  }
  for (const [call, files] of Object.entries(baseline)) {
    const present = new Set(current[call] ?? [])
    for (const file of files) if (!present.has(file)) stale.push(`${file}: overlayAppClient.${call}`)
  }
  return { added: added.sort(), stale: stale.sort() }
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '--', 'src', 'packages', 'apps', 'convex'], { encoding: 'utf8' })
    .split('\n')
    .filter((file) => SOURCE_FILE.test(file) && !file.includes('node_modules') && !file.startsWith('convex/_generated/'))
}

function read(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function main() {
  const update = process.argv.includes('--update')
  const self = fileURLToPath(import.meta.url)
  const failures = []
  const current = {}
  for (const file of trackedFiles()) {
    const source = read(file)
    if (source === null) continue
    if (!TEST_FILE.test(file) && !self.endsWith(file)) {
      for (const finding of findBannedIdentifiers(source)) failures.push(`${file}:${finding.line} ${finding.name}: ${finding.message}`)
    }
    if (isBrowserFile(file)) {
      for (const call of findBrowserHttpCalls(source)) (current[call] ??= []).push(file)
    }
  }
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))
    .map(([call, files]) => [call, [...new Set(files)].sort()]))

  if (update) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`)
    console.log(`Updated ${BASELINE_PATH} with ${Object.keys(sorted).length} browser HTTP calls.`)
  } else {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    const { added, stale } = compareWithBaseline(sorted, baseline)
    if (added.length) {
      failures.push(`New browser HTTP calls. Read or write through a native Convex query or mutation; only server work (model runs, billing, OAuth, email, file bytes, provider calls) belongs on HTTP. If this one does, run with --update and say why in the PR:\n  ${added.join('\n  ')}`)
    }
    if (stale.length) {
      failures.push(`The baseline lists browser HTTP calls that no longer exist. Run with --update to shrink it:\n  ${stale.join('\n  ')}`)
    }
  }
  if (failures.length) {
    console.error(`check-native-architecture failed:\n${failures.join('\n')}`)
    process.exit(1)
  }
  if (!update) console.log(`check-native-architecture: clean (${Object.keys(sorted).length} baseline browser HTTP calls)`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
