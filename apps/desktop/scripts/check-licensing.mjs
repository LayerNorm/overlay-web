import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (relative) =>
  JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const failures = []

const requiredDocs = [
  'LICENSE',
  'LICENSE.md',
  'NOTICE.md',
  'TRADEMARKS.md',
  'THIRD_PARTY_NOTICES.md',
  'ASSET_LICENSES.md'
]
for (const relative of requiredDocs) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`missing ${relative}`)
}

const rootManifest = readJson('package.json')
if (rootManifest.license !== 'AGPL-3.0-or-later') {
  failures.push('root package.json must declare AGPL-3.0-or-later')
}

const packageRoot = path.join(root, 'packages')
const packageDirs = fs
  .readdirSync(packageRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

for (const directory of packageDirs) {
  const relative = `packages/${directory}`
  const manifest = readJson(`${relative}/package.json`)
  if (manifest.license !== 'Apache-2.0') {
    failures.push(`${relative}/package.json must declare Apache-2.0`)
  }
  if (manifest.private !== false) {
    failures.push(`${relative}/package.json must explicitly set private to false`)
  }
  if (manifest.publishConfig?.access !== 'public' || manifest.publishConfig?.provenance !== true) {
    failures.push(`${relative}/package.json must require public access and provenance`)
  }
  if (!fs.existsSync(path.join(root, relative, 'LICENSE'))) {
    failures.push(`${relative} is missing its Apache-2.0 LICENSE`)
  }
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
const lock = readJson('package-lock.json')
const allowlist = readJson('scripts/license-allowlist.json').runtimeLicenseExceptions
let audited = 0

for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
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
  if (isAcceptableLicenseExpression(license)) continue
  const packageName = packageNameFromLockPath(packagePath)
  const exception = allowlist.find(
    (entry) =>
      matchesPackagePattern(packageName, entry.package) &&
      entry.licenses.includes(license) &&
      entry.reason.trim()
  )
  if (!exception) {
    failures.push(`${packagePath} has unreviewed runtime license "${license}"`)
  }
}
if (audited === 0) failures.push('no runtime dependencies were audited')

if (failures.length) {
  console.error(`License check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  process.exit(1)
}

console.log(
  `License check passed: AGPL desktop, ${packageDirs.length} Apache packages, ` +
    `${audited} runtime dependency entries, and required notices verified.`
)

function stringifyLicense(license) {
  if (!license) return 'MISSING'
  if (typeof license === 'string') return license
  return (
    license
      .map((entry) => (typeof entry === 'string' ? entry : entry.type))
      .filter(Boolean)
      .join(' OR ') || 'MISSING'
  )
}

function isAcceptableLicenseExpression(value) {
  const expression = stripOuterParens(value.trim())
  if (!expression || expression === 'MISSING') return false
  const orParts = expression.split(/\s+OR\s+/i).map(stripOuterParens)
  if (orParts.length > 1) return orParts.some(isAcceptableLicenseExpression)
  const andParts = expression.split(/\s+AND\s+/i).map(stripOuterParens)
  if (andParts.length > 1) return andParts.every(isAcceptableLicenseExpression)
  return allowedLicenseIds.has(expression)
}

function stripOuterParens(value) {
  let current = value.trim()
  while (current.startsWith('(') && current.endsWith(')')) {
    current = current.slice(1, -1).trim()
  }
  return current
}

function packageNameFromLockPath(packagePath) {
  const tail = packagePath.split('node_modules/').filter(Boolean).pop()
  const parts = tail.split('/')
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
}

function matchesPackagePattern(packageName, pattern) {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`).test(packageName)
}
