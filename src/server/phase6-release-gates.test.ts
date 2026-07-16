import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveOverlayCapabilities } from '@overlay/app-core'
import { createOverlayServerContext } from './bootstrap'
import { OpenAILLMGateway, OpenRouterGateway } from './ai/providers'
import { API_KEY_LENGTH, API_KEY_PREFIX, generateApiKey, isApiKeyCandidate } from './auth/api-keys/crypto'
import { getRequiredApiKeyScopesForRoute } from './auth/api-keys/route-scopes'
import { OidcAuthProvider, WorkOSAuthProvider } from './auth/providers'
import { NoOpBillingProvider, StripeBillingProvider } from './billing/providers'
import { getCapabilityDisabledError, getRequiredCapabilityForRoute } from './capabilities-core'
import { R2ObjectStore, S3CompatibleObjectStore } from './storage/providers'
import {
  CreateWebhookSubscriptionRequest,
  WebhookEventSchema,
} from '@/shared/schemas/webhooks'
import {
  parseOverlayRuntimeConfig,
  type OverlayRuntimeConfig,
  type OverlayRuntimeConfigInput,
} from '@/shared/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

type DisabledCapability = 'billing' | 'webhooks' | 'apiKeys' | 'vectorSearch' | 'automations'

function fixture(name: string): OverlayRuntimeConfig {
  return parseOverlayRuntimeConfig(
    JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/config', name), 'utf8')),
  )
}

test('Phase 6.7 provider gate covers SaaS WorkOS/Stripe/R2/OpenRouter and on-prem OIDC/S3/OpenAI', () => {
  const saas = createOverlayServerContext({ appConfig: {}, runtimeConfig: fixture('saas-staging.json') })
  assert.equal(saas.auth instanceof WorkOSAuthProvider, true)
  assert.equal(saas.billing instanceof StripeBillingProvider, true)
  assert.equal(saas.objectStore instanceof R2ObjectStore, true)
  assert.equal(saas.llmGateway instanceof OpenRouterGateway, true)

  const onprem = createOverlayServerContext({ appConfig: {}, runtimeConfig: fixture('onprem-s3-oidc-openai.json') })
  assert.equal(onprem.auth instanceof OidcAuthProvider, true)
  assert.equal(onprem.billing instanceof NoOpBillingProvider, true)
  assert.equal(onprem.objectStore instanceof S3CompatibleObjectStore, true)
  assert.equal(onprem.llmGateway instanceof OpenAILLMGateway, true)
})

test('Phase 6.7 provider gate covers Keycloak-compatible issuer through OIDC selection', () => {
  const input = JSON.parse(JSON.stringify(fixture('onprem-s3-oidc-openai.json'))) as OverlayRuntimeConfigInput
  input.auth.provider = 'oidc'
  input.auth.oidc = {
    issuerUrl: 'https://keycloak.enterprise.example.com/realms/overlay',
    clientId: 'overlay-web',
    clientSecret: 'keycloak_fixture_secret',
  }

  const context = createOverlayServerContext({
    appConfig: {},
    runtimeConfig: parseOverlayRuntimeConfig(input),
  })

  assert.equal(context.auth instanceof OidcAuthProvider, true)
})

test('Phase 6.7 API key gate covers format, scopes, and management route capability gating', () => {
  const key = generateApiKey()
  assert.equal(key.startsWith(API_KEY_PREFIX), true)
  assert.equal(key.length, API_KEY_LENGTH)
  assert.equal(isApiKeyCandidate(key), true)
  assert.deepEqual(getRequiredApiKeyScopesForRoute('GET', '/api/v1/files'), ['files:read'])
  assert.deepEqual(getRequiredApiKeyScopesForRoute('POST', '/api/v1/conversations/act'), ['chat:write'])
  assert.deepEqual(getRequiredApiKeyScopesForRoute('DELETE', '/api/v1/api-keys'), ['admin'])
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/api-keys'), 'apiKeys')
  assert.deepEqual(getCapabilityDisabledError('apiKeys'), {
    error: 'API key management is disabled for this deployment.',
    code: 'capability_disabled',
    capability: 'apiKeys',
  })
})

test('Phase 6.7 webhook gate covers schema and management route capability gating', () => {
  assert.equal(
    WebhookEventSchema.parse({
      id: 'evt_phase6',
      type: 'automation.finished',
      createdAt: 1,
      userId: 'user_1',
      data: { automationId: 'auto_1' },
    }).type,
    'automation.finished',
  )
  assert.deepEqual(
    CreateWebhookSubscriptionRequest.parse({
      url: 'https://example.com/webhook',
      events: ['chat.completed', 'chat.failed'],
    }).events,
    ['chat.completed', 'chat.failed'],
  )

  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/webhooks'), 'webhooks')
  assert.deepEqual(getCapabilityDisabledError('webhooks'), {
    error: 'Webhook management is disabled for this deployment.',
    code: 'capability_disabled',
    capability: 'webhooks',
  })
})

test('Phase 6.7 capability gate blocks disabled routes and preserves basic file listing', () => {
  const config = parseOverlayRuntimeConfig(
    JSON.parse(readFileSync(path.join(repoRoot, 'docs/config/onprem-minimal.example.json'), 'utf8')),
  )
  const capabilities = deriveOverlayCapabilities(config)
  assert.equal(capabilities.billing, false)
  assert.equal(capabilities.apiKeys, false)
  assert.equal(capabilities.webhooks, false)
  assert.equal(capabilities.vectorSearch, false)
  assert.equal(capabilities.automations, false)

  const routeExpectations = [
    ['GET', '/api/v1/subscription', 'billing'],
    ['GET', '/api/v1/webhooks', 'webhooks'],
    ['GET', '/api/v1/api-keys', 'apiKeys'],
    ['POST', '/api/v1/knowledge/search', 'vectorSearch'],
    ['POST', '/api/v1/automations/run', 'automations'],
  ] as ReadonlyArray<readonly [method: string, pathname: string, capability: DisabledCapability]>

  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/files'), 'files')
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/files/file_1/content'), 'files')

  for (const [method, pathname, capability] of routeExpectations) {
    assert.equal(getRequiredCapabilityForRoute(method, pathname), capability)
    assert.deepEqual(getCapabilityDisabledError(capability), {
      error: `${capabilityLabel(capability)} is disabled for this deployment.`,
      code: 'capability_disabled',
      capability,
    })
  }
})

function capabilityLabel(capability: DisabledCapability): string {
  switch (capability) {
    case 'billing':
      return 'Billing'
    case 'webhooks':
      return 'Webhook management'
    case 'apiKeys':
      return 'API key management'
    case 'vectorSearch':
      return 'Vector search'
    case 'automations':
      return 'Automation scheduling'
  }
}
