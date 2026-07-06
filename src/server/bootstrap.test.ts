import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnthropicGateway } from '@overlay/llm-gateway/anthropic'
import { GroqGateway } from '@overlay/llm-gateway/groq'
import { createOverlayServerContext } from './bootstrap'
import { OpenAILLMGateway, OpenRouterGateway } from './ai/providers'
import { ApiKeyService } from './auth/api-keys'
import { BetterAuthProvider, OidcAuthProvider, WorkOSAuthProvider } from './auth/providers'
import { NoOpBillingProvider, StripeBillingProvider } from './billing/providers'
import { OverlayConfigError } from './config'
import { ConvexRateLimiter, InMemoryEventBus, InMemoryRateLimiter } from './shared/providers'
import { R2ObjectStore, S3CompatibleObjectStore } from './storage/providers'
import { parseOverlayRuntimeConfig, type OverlayRuntimeConfig } from '../shared/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

function fixture(name: string): OverlayRuntimeConfig {
  return parseOverlayRuntimeConfig(
    JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/config', name), 'utf8')),
  )
}

test('createOverlayServerContext returns SaaS adapters for WorkOS, Stripe, R2, and OpenRouter config', () => {
  const runtimeConfig = fixture('saas-staging.json')
  const context = createOverlayServerContext({ appConfig: {}, runtimeConfig })

  assert.equal(context.auth instanceof WorkOSAuthProvider, true)
  assert.equal(context.billing instanceof StripeBillingProvider, true)
  assert.equal(context.objectStore instanceof R2ObjectStore, true)
  assert.equal(context.llmGateway instanceof OpenRouterGateway, true)
  assert.equal(context.rateLimiter instanceof ConvexRateLimiter, true)
  assert.equal(context.eventBus instanceof InMemoryEventBus, true)
  assert.equal(context.apiKeyService, ApiKeyService)
})

test('createOverlayServerContext returns enterprise adapters for OIDC, no billing, S3, and OpenAI config', () => {
  const runtimeConfig = fixture('onprem-s3-oidc-openai.json')
  const context = createOverlayServerContext({ appConfig: {}, runtimeConfig })

  assert.equal(context.auth instanceof OidcAuthProvider, true)
  assert.equal(context.billing instanceof NoOpBillingProvider, true)
  assert.equal(context.objectStore instanceof S3CompatibleObjectStore, true)
  assert.equal(context.llmGateway instanceof OpenAILLMGateway, true)
  assert.equal(context.rateLimiter instanceof InMemoryRateLimiter, true)
})

test('createOverlayServerContext returns Better Auth adapter when selected', () => {
  const base = fixture('saas-staging.json')
  const runtimeConfig = parseOverlayRuntimeConfig({
    ...base,
    providers: {
      ...base.providers,
      auth: { provider: 'better-auth' },
    },
    auth: {
      provider: 'better-auth',
      allowDevFallbacks: false,
      workos: {},
      oidc: {},
      betterAuth: {
        baseUrl: 'https://staging.getoverlay.io',
        secret: 'better_auth_secret',
        databaseUrl: 'postgres://overlay_auth:secret@localhost:5432/overlay_auth',
        defaultSsoProviderId: 'pilot-oidc',
        defaultSsoDomain: 'example.com',
        oidcIssuerUrl: 'https://idp.example.com',
        oidcClientId: 'overlay-web',
        oidcClientSecret: 'oidc_secret',
        jwtAudience: 'https://staging.getoverlay.io',
        jwksUrl: 'https://staging.getoverlay.io/api/better-auth/jwks',
      },
    },
  })
  const context = createOverlayServerContext({ appConfig: {}, runtimeConfig })

  assert.equal(context.auth instanceof BetterAuthProvider, true)
})

test('createOverlayServerContext throws typed config error before constructing invalid provider config', () => {
  const invalid = JSON.parse(JSON.stringify(fixture('saas-staging.json'))) as Record<string, unknown>
  const storage = invalid.storage as { r2: Record<string, unknown> }
  delete storage.r2.bucketName
  const runtimeConfig = parseOverlayRuntimeConfig(invalid)

  assert.throws(
    () => createOverlayServerContext({ appConfig: {}, runtimeConfig }),
    (error) =>
      error instanceof OverlayConfigError &&
      error.issues.some((issue) => issue.includes('storage.r2.bucketName')),
  )
})

test('configured adapters receive runtime values instead of unrelated production env vars', () => {
  const previousStripeSecretKey = process.env.STRIPE_SECRET_KEY
  process.env.STRIPE_SECRET_KEY = 'sk_live_unrelated_prod_value'
  try {
    const runtimeConfig = fixture('saas-staging.json')
    const context = createOverlayServerContext({ appConfig: {}, runtimeConfig })

    const authSummary = (context.auth as WorkOSAuthProvider).providerConfigSummary
    const billingSummary = (context.billing as StripeBillingProvider).providerConfigSummary
    const storageSummary = (context.objectStore as R2ObjectStore).providerConfigSummary
    const llmSummary = (context.llmGateway as OpenRouterGateway).providerConfigSummary

    assert.equal(authSummary.clientId, 'client_staging_fixture')
    assert.equal(billingSummary.mode, 'test')
    assert.equal(billingSummary.hasSecretKey, true)
    assert.equal(storageSummary.bucketName, 'overlay-staging')
    assert.equal(llmSummary.defaultChatModelId, 'openrouter/free')
  } finally {
    if (previousStripeSecretKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY
    } else {
      process.env.STRIPE_SECRET_KEY = previousStripeSecretKey
    }
  }
})

test('configured Anthropic and Groq gateways use real provider adapters instead of no-op placeholders', () => {
  const base = fixture('onprem-s3-oidc-openai.json')

  const anthropic = parseOverlayRuntimeConfig({
    ...base,
    llm: {
      ...base.llm,
      gatewayProvider: 'anthropic',
      defaultChatModelId: 'claude-sonnet-4-6',
      modelAllowlist: ['claude-sonnet-4-6'],
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    },
  })
  const groq = parseOverlayRuntimeConfig({
    ...base,
    llm: {
      ...base.llm,
      gatewayProvider: 'groq',
      defaultChatModelId: 'openai/gpt-oss-120b',
      modelAllowlist: ['openai/gpt-oss-120b'],
      apiKeyEnvVar: 'GROQ_API_KEY',
    },
  })

  assert.equal(createOverlayServerContext({ appConfig: {}, runtimeConfig: anthropic }).llmGateway instanceof AnthropicGateway, true)
  assert.equal(createOverlayServerContext({ appConfig: {}, runtimeConfig: groq }).llmGateway instanceof GroqGateway, true)
})
