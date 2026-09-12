import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../../packages/overlay-modules-react/src', import.meta.url).pathname
const banned = [
  { pattern: /\bfetch\s*\(/, label: 'direct fetch calls' },
  { pattern: /overlayAppClient/, label: 'overlayAppClient imports or usage' },
  { pattern: /next\/navigation/, label: 'Next router imports' },
  { pattern: /@\/contexts\/AuthContext|useAuth|AuthContext/, label: 'web auth context imports' },
  { pattern: /convex/i, label: 'Convex imports or usage' },
  { pattern: /from ['"]@\//, label: 'web app private imports' },
]

function walk(dir) {
  const entries = readdirSync(dir)
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      files.push(...walk(path))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(path)
    }
  }
  return files
}

const failures = []
for (const file of walk(root)) {
  const source = readFileSync(file, 'utf8')
  for (const rule of banned) {
    if (rule.pattern.test(source)) {
      failures.push(`${file}: ${rule.label}`)
    }
  }
}

if (failures.length > 0) {
  console.error('Presentational module boundary check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Presentational module boundary check passed.')
