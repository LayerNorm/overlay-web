/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])
const FORBIDDEN_PATTERNS = [
  /\/api\/auth\/native\/provider-keys/,
  /\bfetchKeyFromAppServer\b/,
  /\bfetchAllKeys\b/
]

function sourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path))
    } else if (SOURCE_EXTENSIONS.has(extname(path))) {
      files.push(path)
    }
  }
  return files
}

for (const path of sourceFiles('src')) {
  const source = readFileSync(path, 'utf8')
  for (const pattern of FORBIDDEN_PATTERNS) {
    assert.doesNotMatch(
      source,
      pattern,
      `${path} reintroduces reusable provider-key delivery to the desktop`
    )
  }
}

const releaseWorkflow = readFileSync('.github/workflows/release-mac.yml', 'utf8')
assert.match(
  releaseWorkflow,
  /if:\s*\$\{\{\s*false\s*\}\}/,
  'Official release workflow must remain frozen until the security release gate passes'
)

const unifiedTools = readFileSync('src/main/services/agent/unified-tools.ts', 'utf8')
assert.match(
  unifiedTools,
  /applyContainmentToolProfile\(tools\)/,
  'Unified agent tools must apply the Phase 0 containment profile'
)

const ipcRegistry = readFileSync('src/main/ipc/index.ts', 'utf8')
assert.match(
  ipcRegistry,
  /if \(unsafeLocalCapabilitiesEnabled\) \{[\s\S]*registerTerminalIPC\(\)[\s\S]*registerRuntimeIPC\(\)/,
  'Terminal and runtime IPC must remain behind the Phase 0 containment profile'
)

console.log('Phase 0 desktop security containment check passed.')
