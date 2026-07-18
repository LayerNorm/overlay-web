import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceRoot = join(packageRoot, 'src')

const retiredPaths = ['src/components/ExchangeBlock.tsx', 'src/components/MessageList.tsx', 'src/components/tools']

const violations = retiredPaths
  .filter((path) => existsSync(join(packageRoot, path)))
  .map((path) => `${path} must stay deleted`)

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

for (const path of sourceFiles(sourceRoot)) {
  const source = readFileSync(path, 'utf8')
  if (/from\s+['"][^'"]*\/components\/tools(?:\/|['"])/.test(source)) {
    violations.push(`${relative(packageRoot, path)} imports the retired tool renderer family`)
  }
  if (/\b(?:ExchangeBlock|MessageList|ToolCallGroup)\b/.test(source)) {
    violations.push(`${relative(packageRoot, path)} references a retired transcript compatibility API`)
  }
}

const packageJson = readFileSync(join(packageRoot, 'package.json'), 'utf8')
if (packageJson.includes('exchange-block')) {
  violations.push('package.json exports the retired exchange-block compatibility path')
}

if (violations.length) {
  console.error(`Chat transcript boundary check failed:\n${violations.map((item) => `- ${item}`).join('\n')}`)
  process.exit(1)
}

console.log('Chat transcript boundary check passed.')
