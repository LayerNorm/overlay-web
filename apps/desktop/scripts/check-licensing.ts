import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error -- plain ESM helper shared with the repository's supply-chain checks
import { installedManifest, productionPackages, readBunLock } from '../../../scripts/ci/bun-lock.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (relative: string): Record<string, any> =>
  JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const failures: string[] = []

for (const relative of ['LICENSE', 'TRADEMARKS.md', 'THIRD_PARTY_NOTICES.md']) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`missing ${relative}`)
}
if (readJson('package.json').license !== 'AGPL-3.0-or-later') {
  failures.push('root package.json must declare AGPL-3.0-or-later')
}

const allowedLicenseIds = new Set([
  '0BSD',
  'AFL-2.1',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib'
])
let audited = 0
const check = (label: string, license: string) => {
  audited += 1
  if (!isAcceptable(license)) failures.push(`${label} has unreviewed runtime license "${license}"`)
}
// The app ships its production dependencies from the monorepo's bun.lock...
const repositoryRoot = path.resolve(root, '../..')
for (const [id, entry] of productionPackages(readBunLock(repositoryRoot), ['apps/desktop']) as Map<
  string,
  { name: string; version: string; optional: boolean }
>) {
  // Overlay's own Agent Host, AGPL like this app.
  if (entry.name.startsWith('@layernorm/')) continue
  const manifest = installedManifest(entry.name, entry.version, repositoryRoot)
  if (!manifest) {
    // Optional per-platform binaries for other systems are not installed here.
    if (!entry.optional) failures.push(`${id} is a runtime dependency but is not installed`)
    continue
  }
  check(id, stringifyLicense(manifest.license ?? manifest.licenses))
}
// ...and the Agent Host bundle, which has its own npm lockfile.
for (const [packagePath, metadata] of Object.entries<any>(readJson('agent-host-bundle/package-lock.json').packages)) {
  if (
    !packagePath.startsWith('node_modules/') ||
    packagePath.startsWith('node_modules/@layernorm/') ||
    !metadata.version ||
    metadata.dev === true ||
    metadata.devOptional === true
  ) {
    continue
  }
  check(`agent-host-bundle/${packagePath}`, stringifyLicense(metadata.license ?? metadata.licenses))
}
if (audited === 0) failures.push('no runtime dependencies were audited')

if (failures.length) {
  console.error(`License check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  process.exit(1)
}
console.log(`License check passed for ${audited} runtime dependency entries.`)

function stringifyLicense(
  license: string | { type?: string } | Array<string | { type?: string }> | undefined
): string {
  if (!license) return 'MISSING'
  if (typeof license === 'string') return license
  if (!Array.isArray(license)) return license.type || 'MISSING'
  return (
    license
      .map((entry) => (typeof entry === 'string' ? entry : entry.type))
      .filter(Boolean)
      .join(' OR ') || 'MISSING'
  )
}

function isAcceptable(value: string): boolean {
  const expression = stripOuterParens(value.trim())
  if (!expression || expression === 'MISSING') return false
  const orParts = expression.split(/\s+OR\s+/i).map(stripOuterParens)
  if (orParts.length > 1) return orParts.some(isAcceptable)
  const andParts = expression.split(/\s+AND\s+/i).map(stripOuterParens)
  if (andParts.length > 1) return andParts.every(isAcceptable)
  return allowedLicenseIds.has(expression)
}

function stripOuterParens(value: string): string {
  let current = value.trim()
  while (current.startsWith('(') && current.endsWith(')')) current = current.slice(1, -1).trim()
  return current
}
