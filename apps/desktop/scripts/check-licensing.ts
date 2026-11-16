import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
for (const [packagePath, metadata] of Object.entries<any>(readJson('package-lock.json').packages)) {
  if (
    !packagePath.startsWith('node_modules/') ||
    packagePath.startsWith('node_modules/@overlay/') ||
    !metadata.version ||
    metadata.dev === true ||
    metadata.devOptional === true
  ) {
    continue
  }
  audited += 1
  const license = stringifyLicense(metadata.license ?? metadata.licenses)
  if (!isAcceptable(license)) failures.push(`${packagePath} has unreviewed runtime license "${license}"`)
}
if (audited === 0) failures.push('no runtime dependencies were audited')

if (failures.length) {
  console.error(`License check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  process.exit(1)
}
console.log(`License check passed for ${audited} runtime dependency entries.`)

function stringifyLicense(license: string | Array<string | { type?: string }> | undefined): string {
  if (!license) return 'MISSING'
  if (typeof license === 'string') return license
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
