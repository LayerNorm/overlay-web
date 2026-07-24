import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const packageJson = JSON.parse(read('package.json'))
assert.match(
  packageJson.scripts?.test ?? '',
  /test:desktop.*test:packages/,
  'root test command must cover desktop and public workspace packages'
)

const mainEntry = read('src/main/index.ts')
assert.doesNotMatch(
  mainEntry,
  /console\.(?:log|warn|error)\([^)]*(?:transferredSession\.user|accessToken|refreshToken)/s,
  'main process must not log transferred identity or tokens'
)

const authStep = read('src/renderer/src/components/onboarding/steps/AuthStep.tsx')
assert.doesNotMatch(
  authStep,
  /console\.(?:log|warn|error)\([^)]*data\.user/s,
  'renderer must not log transferred identity'
)

const convexClient = read('src/main/services/convex-client.ts')
assert.doesNotMatch(
  convexClient,
  /JSON\.stringify\(data\).*console|console\.(?:log|warn|error)\([^)]*JSON\.stringify\(data\)/s,
  'backend response payloads must not be written to logs'
)

const subscription = read('src/main/services/subscription-service.ts')
assert.doesNotMatch(
  subscription,
  /user-id\.json|substring\(0,\s*10\)/,
  'user identity must stay in OS-protected auth state and process memory'
)
assert.match(subscription, /mode:\s*0o600/, 'local entitlement cache must be owner-only')

const chatPanel = read('src/renderer/src/pages/ChatPanel.tsx')
assert.doesNotMatch(
  chatPanel,
  /console\.(?:log|warn|error)\([^)]*mention\.filepath/s,
  'workspace paths must not be written to renderer logs'
)

const appApi = read('src/main/ipc/app-api-ipc.ts')
assert.match(appApi, /appApiPathForLog\(request\.path\)/, 'API logs must strip URL queries')
assert.doesNotMatch(
  appApi,
  /console\.(?:log|warn|error)\([^)]*bodyText/s,
  'server response bodies must not be written to local logs'
)

for (const requiredTest of [
  'src/main/services/security/native-auth-service.test.ts',
  'src/main/services/security/safe-storage-service.test.ts',
  'src/main/services/security/secure-ipc-main.test.ts',
  'src/main/services/security/server-profile-service.test.ts'
]) {
  assert.ok(fs.existsSync(path.join(root, requiredTest)), `missing negative-security test ${requiredTest}`)
}

console.log('Security verification invariants passed.')
