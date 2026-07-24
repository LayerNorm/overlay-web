import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const agentBrowser = readFileSync('src/main/services/agent-browser-service.ts', 'utf8')
const unifiedTools = readFileSync('src/main/services/agent/unified-tools.ts', 'utf8')
const browserManager = readFileSync('src/main/services/browser-manager.ts', 'utf8')
const browserPolicy = readFileSync(
  'src/main/services/security/browser-security-policy.ts',
  'utf8'
)
const networkPolicy = readFileSync(
  'src/main/services/security/network-destination-policy.ts',
  'utf8'
)
const helperPolicy = readFileSync(
  'src/main/services/security/local-helper-process.ts',
  'utf8'
)
const whisperKit = readFileSync('src/main/services/whisperkit-service.ts', 'utf8')
const parakeet = readFileSync('src/main/services/parakeet-service.ts', 'utf8')
const secureIpc = readFileSync('src/main/services/security/secure-ipc-main.ts', 'utf8')

assert.doesNotMatch(
  agentBrowser,
  /persist:overlay-agent-browser/,
  'Agent browsing must never reuse a persistent partition'
)
assert.match(
  agentBrowser,
  /partition:\s*`overlay-agent-\$\{taskId\}-\$\{randomUUID\(\)\}`/,
  'Agent browsing must use an ephemeral per-task partition'
)
assert.match(
  agentBrowser,
  /setPermissionRequestHandler[\s\S]*callback\(false\)[\s\S]*setPermissionCheckHandler\(\(\)\s*=>\s*false\)/,
  'Agent browsing must deny both permission requests and checks'
)
assert.match(
  agentBrowser,
  /webRequest\.onBeforeRequest[\s\S]*assertTaskDestination\(taskSession,\s*details\.url\)/,
  'Every agent browser network request must pass the public destination policy'
)
assert.match(
  agentBrowser,
  /resolveHost\(url\.hostname[\s\S]*isNonPublicIp\(address\)/,
  'Agent browsing must confirm destinations through Chromium DNS resolution'
)
assert.match(
  agentBrowser,
  /setProxy\(\{\s*mode:\s*'direct'\s*\}\)/,
  'Agent browsing must not inherit an ambient system proxy'
)
assert.match(
  agentBrowser,
  /getTaskDownloadDirectory[\s\S]*mkdtempSync[\s\S]*destroyTask[\s\S]*rmSync/,
  'Agent downloads must be task-scoped and deleted during task cleanup'
)
assert.match(
  unifiedTools,
  /surface\s*===\s*'chat'[\s\S]*createEphemeralTaskBrowserHandlers\(options\.securityTaskId\)/,
  'Desktop chat browser tools must use the ephemeral agent browser'
)
assert.match(
  unifiedTools,
  /openPublicDownloadStream[\s\S]*resolvePublicHttpDestination\(currentUrl\)/,
  'Agent downloads must validate every destination'
)
assert.match(
  unifiedTools,
  /lookup:\s*pinnedLookup[\s\S]*proxy:\s*false|proxy:\s*false[\s\S]*lookup:\s*pinnedLookup/,
  'Agent downloads must pin validated DNS and ignore ambient proxies'
)
assert.match(
  unifiedTools,
  /maxRedirects:\s*0/,
  'Agent downloads must disable automatic redirect following'
)
assert.match(
  unifiedTools,
  /openSync\(targetPath,\s*'wx',\s*0o600\)/,
  'Agent downloads must use exclusive owner-only creation'
)
assert.match(
  unifiedTools,
  /com\.apple\.quarantine/,
  'Agent downloads must preserve macOS quarantine metadata'
)

assert.match(
  browserManager,
  /setPermissionRequestHandler[\s\S]*setPermissionCheckHandler/,
  'Interactive browsing must implement permission request and check handlers'
)
assert.match(
  browserManager,
  /pending\.rendererWebContentsId\s*!==\s*rendererWebContentsId/,
  'Permission responses must be bound to the renderer that received the prompt'
)
assert.match(
  browserManager,
  /senderOwnsTab[\s\S]*isTabOwnedByWindow/,
  'Interactive browser tab IPC must bind tab identifiers to the sender window'
)
const chatRoleChannels =
  secureIpc.match(/chat:\s*\[([\s\S]*?)\],\s*notebook:/)?.[1] ?? ''
assert.ok(chatRoleChannels, 'Chat IPC role declaration was not found')
assert.doesNotMatch(
  chatRoleChannels,
  /['"]browser:['"]/,
  'A compromised chat renderer must not control the interactive browser partition'
)
assert.match(
  browserManager,
  /PERMISSION_GRANT_TTL_MS[\s\S]*expiresAt[\s\S]*details\.isMainFrame\s*!==\s*true/,
  'Stored browser grants must expire and apply only to main-frame requests'
)
assert.match(
  browserManager,
  /savePermissionDecision\(pending\.origin,\s*pending\.permission,\s*decision\)/,
  'Only the main-owned pending origin and permission may be persisted'
)
assert.match(
  browserManager,
  /browser:resolve-permission[\s\S]*_origin\?:\s*string[\s\S]*_permission\?:\s*string[\s\S]*event\.sender\.id/,
  'Renderer permission metadata must be ignored while sender identity is bound'
)
assert.match(
  browserPolicy,
  /basename\(input\.normalize\('NFKC'\)\)/,
  'Interactive download names must be Unicode-normalized basenames'
)
assert.match(
  networkPolicy,
  /lookup\(hostname,\s*\{\s*all:\s*true,\s*verbatim:\s*true\s*\}\)/,
  'Agent destinations must be checked after DNS resolution'
)

for (const [name, source] of [
  ['WhisperKit', whisperKit],
  ['Parakeet', parakeet]
]) {
  assert.doesNotMatch(
    source,
    /['"]serve['"]|from\s+['"]axios['"]|\bspawn\(/,
    `${name} must not expose a local HTTP service`
  )
  assert.match(source, /--audio-path/, `${name} must use bounded one-shot transcription`)
  assert.match(
    source,
    /env:\s*createLocalHelperEnvironment\(\)/,
    `${name} must not inherit app secrets`
  )
}
assert.doesNotMatch(
  helperPolicy,
  /(?:API_KEY|TOKEN|SECRET|PASSWORD)/,
  'Native helper environment allowlist must not include secret-bearing variables'
)

console.log('Browser, network, download, and local-helper boundary check passed.')
