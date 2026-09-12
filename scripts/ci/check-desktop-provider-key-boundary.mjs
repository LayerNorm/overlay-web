import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const routePath = 'src/app/api/auth/native/provider-keys/route.ts'
assert.equal(
  existsSync(routePath),
  false,
  `${routePath} must not exist — owner provider credentials are server-only and must never be exposed via a client HTTP route`,
)

const providerResolverPath = 'src/server/ai/gateway/server-provider-keys.ts'
const providerResolverSource = readFileSync(providerResolverPath, 'utf8')
assert.match(
  providerResolverSource,
  /assertHostedProviderAccessEnabled\(\)/,
  `${providerResolverPath} must enforce the emergency kill switch before resolving credentials`,
)
assert.match(
  providerResolverSource,
  /workos\.vault|WORKOS_API_KEY|PROVIDER_VAULT_NAMES/,
  `${providerResolverPath} must resolve credentials only on the server (vault/env), never for client delivery`,
)

console.log('Desktop provider-key server boundary check passed (route removed; kill switch enforced).')
