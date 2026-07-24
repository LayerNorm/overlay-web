import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

const forbiddenPaths = [
  '.git',
  '.windsurf',
  'AGENTS.md',
  'CLAUDE.md',
  'DESIGN.md',
  'OVERLAY.md',
  'ai-sdk.md',
  'composio-full.md',
  'composio-index.md',
  'landing-page-flow.md',
  'overlay-grand-slam-offer-checklist.csv',
  'overlay-pitch-deck.md',
  'plans',
  'reports',
  'token-counting.md',
  '.env',
  '.env.local',
  '.env.development.local',
  '.env.production.local'
]

for (const relative of forbiddenPaths) {
  if (fs.existsSync(path.join(root, relative))) {
    failures.push(`private or generated path is present: ${relative}`)
  }
}

const requiredPaths = [
  '.env.example',
  '.github/CODEOWNERS',
  '.github/dependabot.yml',
  '.github/workflows/clean-clone.yml',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'packages',
  'src'
]
for (const relative of requiredPaths) {
  if (!fs.existsSync(path.join(root, relative))) {
    failures.push(`required public path is missing: ${relative}`)
  }
}

const sensitiveNamePattern =
  /(^|\/)(?:\.env\.(?!example$)|.*\.(?:pem|p12|pfx|mobileprovision)|id_(?:rsa|ed25519)|credentials?\.json)$/i
for (const relative of walk(root)) {
  if (sensitiveNamePattern.test(relative)) {
    failures.push(`sensitive filename is present: ${relative}`)
  }
}

if (failures.length) {
  console.error(
    `Public tree check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`
  )
  process.exit(1)
}

console.log('Public tree check passed: required files exist and private-only paths are absent.')

function walk(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name)
    const absolute = path.join(directory, entry.name)
    if (
      entry.isDirectory() &&
      !['.build', '.cache', 'build', 'coverage', 'dist', 'node_modules', 'out'].includes(
        entry.name
      )
    ) {
      return walk(absolute, relative)
    }
    return entry.isFile() ? [relative] : []
  })
}
