/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])

function sourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path))
    else if (SOURCE_EXTENSIONS.has(extname(path))) files.push(path)
  }
  return files
}

const mainFiles = sourceFiles('src/main')
for (const path of mainFiles) {
  const source = readFileSync(path, 'utf8')
  if (path.endsWith('secure-ipc-main.ts')) continue
  assert.doesNotMatch(
    source,
    /import\s*\{[^}]*\bipcMain\b[^}]*\}\s*from\s*['"]electron['"]/s,
    `${path} bypasses the mandatory secure IPC registrar`
  )
}

const preload = readFileSync('src/preload/index.ts', 'utf8')
assert.doesNotMatch(preload, /\belectronAPI\b/, 'Preload must not expose the toolkit Electron API')
assert.doesNotMatch(
  preload,
  /exposeInMainWorld\(\s*['"]electron['"]/,
  'Preload must expose only the fixed Overlay bridge'
)

for (const path of sourceFiles('src/renderer/src')) {
  if (path.includes('.test.') || path.includes('.spec.')) continue
  const source = readFileSync(path, 'utf8')
  assert.doesNotMatch(source, /window\.electron\b/, `${path} uses generic renderer IPC`)
  assert.doesNotMatch(
    source,
    /\bsession\?\.(?:accessToken|refreshToken)\b|\bsession\.(?:accessToken|refreshToken)\b|\b(?:accessToken|refreshToken)\s*:\s*string\b|Authorization\s*:\s*[`'"]Bearer\b/,
    `${path} exposes an authentication token to the renderer`
  )
}

const allDesktopSource = sourceFiles('src')
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
for (const forbidden of [
  'auth:set-authenticated',
  'auth:exchange-code',
  'security:store-auth-session',
  'security:get-auth-session',
  'security:store-session-transfer-verifier',
  'subscription:record-usage',
  'security:track-usage',
  "password-store', 'basic",
  'use-mock-keychain'
]) {
  assert.ok(
    !allDesktopSource.includes(forbidden),
    `Forbidden Electron boundary found: ${forbidden}`
  )
}

const browserManager = readFileSync('src/main/services/browser-manager.ts', 'utf8')
const webContentsPreferences =
  browserManager.match(
    /new WebContentsView\(\{[\s\S]*?webPreferences:\s*\{([\s\S]*?)\}\s*\}\)/
  )?.[1] ?? ''
assert.ok(webContentsPreferences, 'Browser WebContentsView preferences were not found')
assert.doesNotMatch(
  webContentsPreferences,
  /\bpreload\s*:/,
  'Untrusted browser content must never receive an application preload'
)

const appApiIpc = readFileSync('src/main/ipc/app-api-ipc.ts', 'utf8')
assert.doesNotMatch(appApiIpc, /addUserIdTo/, 'App API broker must not inject renderer identity')
assert.doesNotMatch(
  appApiIpc,
  /PRODUCTION_APP_API_BASE_URL|appApiBaseUrlCandidates/,
  'App API broker must not fall back across configured server trust boundaries'
)
assert.doesNotMatch(appApiIpc, /accessToken\.slice/, 'App API broker must not log token prefixes')

const mainEntry = readFileSync('src/main/index.ts', 'utf8')
assert.doesNotMatch(
  mainEntry,
  /(?:console\.(?:log|error|warn)|auditLogger\.log)\([^)]*(?:deep.?link|url)[^)]*,\s*url\b/is,
  'Deep-link URLs may contain authorization codes and must never be logged'
)
assert.doesNotMatch(
  mainEntry,
  /urlObj\.pathname\.includes\(\s*['"]\/transfer['"]\s*\)/,
  'Session-transfer deep links must match an exact path'
)

console.log('Secure Electron trust-boundary check passed.')
