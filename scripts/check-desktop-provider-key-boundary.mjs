import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const routePath = 'src/app/api/auth/native/provider-keys/route.ts'
const routeSource = readFileSync(routePath, 'utf8')

assert.doesNotMatch(
  routeSource,
  /getServerProviderKey|resolveAuthenticatedAppUser|keys\s*:/,
  `${routePath} must remain a fail-closed tombstone and must not resolve provider credentials`,
)
assert.match(routeSource, /status:\s*410/, `${routePath} must return 410 Gone to legacy clients`)
assert.match(
  routeSource,
  /provider_credentials_server_only/,
  `${routePath} must return the stable server-only error code`,
)

const providerResolverPath = 'src/server/ai/gateway/server-provider-keys.ts'
const providerResolverSource = readFileSync(providerResolverPath, 'utf8')
assert.match(
  providerResolverSource,
  /assertHostedProviderAccessEnabled\(\)/,
  `${providerResolverPath} must enforce the emergency kill switch before resolving credentials`,
)

console.log('Desktop provider-key server boundary check passed.')
