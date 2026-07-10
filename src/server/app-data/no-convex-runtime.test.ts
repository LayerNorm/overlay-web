import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import { NoOpBillingProvider } from '@/server/billing/providers'
import { PostgresActConversationRepository } from '@/server/conversations/PostgresActConversationRepository'
import { UnlimitedUsagePolicy } from '@/server/conversations/ActUsagePolicy'
import { PostgresFileRepository } from '@/server/files/PostgresFileRepository'
import { PostgresNoteRepository } from '@/server/notes'
import { PostgresOnboardingRepository } from '@/server/onboarding'
import { InMemoryRateLimiter } from '@/server/shared/providers'
import { InMemoryVectorStore } from '@/server/storage/providers/in-memory-vector-store'
import { PostgresAppSettingsRepository } from '@/server/settings'
import { PostgresUserRepository } from '@/server/users'
import { parseOverlayRuntimeConfig, type OverlayRuntimeConfig } from '@/shared/config'
import { createOverlayServerContext } from '../bootstrap'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const convexEnvironmentKeys = [
  'CONVEX_DEPLOYMENT',
  'DEV_NEXT_PUBLIC_CONVEX_URL',
  'NEXT_PUBLIC_CONVEX_URL',
] as const

function postgresRuntimeConfig(): OverlayRuntimeConfig {
  const base = parseOverlayRuntimeConfig(
    JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/config/saas-staging.json'), 'utf8')),
  )

  return parseOverlayRuntimeConfig({
    ...base,
    app: {
      ...base.app,
      cspConnectSrc: [],
      deploymentEnvironment: 'onprem',
      publicEnv: {
        NEXT_PUBLIC_APP_URL: 'https://overlay.enterprise.example.com',
      },
    },
    auth: {
      provider: 'oidc',
      allowDevFallbacks: false,
      workos: {},
      betterAuth: {},
      oidc: {
        issuerUrl: 'https://idp.enterprise.example.com',
        clientId: 'overlay-web',
        clientSecret: 'oidc_fixture_secret',
        audience: 'overlay-api',
      },
    },
    billing: {
      provider: 'none',
      stripe: {},
    },
    capabilities: {
      ...base.capabilities,
      apiKeys: false,
      automations: false,
      billing: false,
      vectorSearch: false,
      webhooks: false,
    },
    database: {
      provider: 'postgres',
      postgres: {
        connectionString: 'postgres://overlay_app:secret@localhost:54330/overlay_app',
        sslMode: 'disable',
      },
    },
    providers: {
      ...base.providers,
      auth: { provider: 'oidc' },
      database: { provider: 'postgres' },
      rateLimit: { provider: 'memory' },
      vectorSearch: { provider: 'none' },
    },
  })
}

test('Postgres server context boots and executes safe policies without Convex configuration or network', async () => {
  const originalFetch = globalThis.fetch
  const previousEnv = new Map(convexEnvironmentKeys.map((key) => [key, process.env[key]]))
  const requestedUrls: string[] = []

  for (const key of convexEnvironmentKeys) delete process.env[key]
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input))
    throw new Error(`Unexpected network request during Postgres bootstrap: ${String(input)}`)
  }

  try {
    const context = createOverlayServerContext({
      appConfig: {},
      runtimeConfig: postgresRuntimeConfig(),
    })

    assert.equal(context.appDataCapabilities.provider, 'postgres')
    assert.equal(context.appDataCapabilities.requiresConvexClient, false)
    assert.equal(context.billing instanceof NoOpBillingProvider, true)
    assert.equal(context.chatUsagePolicy instanceof UnlimitedUsagePolicy, true)
    assert.equal(context.rateLimiter instanceof InMemoryRateLimiter, true)
    assert.equal(context.vectorStore instanceof InMemoryVectorStore, true)

    const repositories = context.appData.repositories
    assert.equal(repositories.accountDeletion instanceof PostgresAccountDataDeletionRepository, true)
    assert.equal(repositories.conversations instanceof PostgresActConversationRepository, true)
    assert.equal(repositories.files instanceof PostgresFileRepository, true)
    assert.equal(repositories.notes instanceof PostgresNoteRepository, true)
    assert.equal(repositories.onboarding instanceof PostgresOnboardingRepository, true)
    assert.equal(repositories.settings instanceof PostgresAppSettingsRepository, true)
    assert.equal(repositories.users instanceof PostgresUserRepository, true)

    const entitlements = await context.chatUsagePolicy.getEntitlements({ userId: 'p0-user' })
    assert.ok(entitlements)
    assert.equal(entitlements.planKind, 'paid')
    const rateLimit = await context.rateLimiter.check('p0-user', [{
      bucket: 'p0-bootstrap',
      limit: 2,
      windowMs: 1_000,
    }])
    assert.equal(rateLimit.allowed, true)
    assert.deepEqual(requestedUrls, [])
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
