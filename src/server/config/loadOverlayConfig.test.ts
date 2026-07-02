import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  configOverridesFromEnv,
  getRedactedOverlayRuntimeConfigSummary,
  loadOverlayConfig,
  type LoadOverlayConfigOptions,
} from './loadOverlayConfig'
import type { OverlayRuntimeConfigInput } from '../../shared/config'

const baseDefaultConfig = {
  app: {
    baseUrl: 'https://default.getoverlay.io',
    deploymentEnvironment: 'staging',
    cspConnectSrc: [],
    publicEnv: {},
  },
  auth: {
    provider: 'workos',
    allowDevFallbacks: false,
    workos: {
      clientId: 'client_default',
      apiKey: 'workos_default_secret',
    },
    oidc: {},
    keycloak: {},
  },
  billing: {
    provider: 'stripe',
    stripe: {
      mode: 'test',
      secretKey: 'sk_test_default',
      webhookSecret: 'whsec_default',
      paidUnitPriceId: 'price_paid_default',
      topupUnitPriceId: 'price_topup_default',
      portalConfigurationId: 'bpc_default',
    },
  },
  storage: {
    provider: 'r2',
    publicUrlPolicy: 'presigned',
    r2: {
      accountId: 'default_account',
      bucketName: 'default-bucket',
      accessKeyId: 'default_access',
      secretAccessKey: 'default_secret',
      endpointUrl: 'https://r2.default.example.com',
    },
    s3: {},
  },
  llm: {
    gatewayProvider: 'openrouter',
    keySource: 'env',
    defaultChatModelId: 'openrouter/free',
    modelAllowlist: ['openrouter/free'],
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
  },
  database: {
    provider: 'convex',
    convexUrl: 'https://default.convex.cloud',
    deployment: 'dev:default',
    internalApiSecret: 'internal_default',
    internalServiceAuthSecret: 'service_default',
    apiKeyHashSecret: 'api_key_hash_default',
  },
  capabilities: {
    billing: true,
    sso: true,
    apiKeys: true,
    webhooks: false,
    vectorSearch: true,
    automations: true,
    multiTenant: false,
  },
} satisfies OverlayRuntimeConfigInput

function load(options: Partial<LoadOverlayConfigOptions>) {
  return loadOverlayConfig({
    defaultConfig: baseDefaultConfig,
    configFilePath: null,
    env: {},
    ...options,
  })
}

test('loadOverlayConfig loads env-only config', async () => {
  const config = await load({
    env: {
      OVERLAY_DEPLOYMENT_ENV: 'staging',
      NEXT_PUBLIC_APP_URL: 'https://env-staging.getoverlay.io',
      NEXT_PUBLIC_CONVEX_URL: 'https://different-caiman-77.convex.cloud',
      CONVEX_DEPLOYMENT: 'dev:different-caiman-77',
      WORKOS_CLIENT_ID: 'client_env',
      WORKOS_API_KEY: 'workos_env_secret',
      DEV_STRIPE_SECRET_KEY: 'sk_test_env',
      DEV_STRIPE_WEBHOOK_SECRET: 'whsec_env',
      DEV_STRIPE_PAID_UNIT_PRICE_ID: 'price_paid_env',
      DEV_STRIPE_TOPUP_UNIT_PRICE_ID: 'price_topup_env',
      DEV_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_env',
      R2_ACCOUNT_ID: 'env_account',
      R2_BUCKET_NAME: 'env-bucket',
      R2_ACCESS_KEY_ID: 'env_access',
      R2_SECRET_ACCESS_KEY: 'env_secret',
      S3_API: 'https://r2.env.example.com',
      OPENROUTER_API_KEY: 'openrouter_env_secret',
      INTERNAL_API_SECRET: 'internal_env',
      INTERNAL_SERVICE_AUTH_SECRET: 'service_env',
      API_KEY_HASH_SECRET: 'api_key_hash_env',
      API_KEYS_ENABLED: '1',
    },
  })

  assert.equal(config.app.baseUrl, 'https://env-staging.getoverlay.io')
  assert.equal(config.auth.workos.clientId, 'client_env')
  assert.equal(config.billing.stripe.secretKey, 'sk_test_env')
  assert.equal(config.storage.r2.bucketName, 'env-bucket')
  assert.equal(config.database.deployment, 'dev:different-caiman-77')
  assert.equal(config.capabilities.apiKeys, true)
})

test('configOverridesFromEnv maps enterprise v2 feature, provider, and compliance overrides', () => {
  const overrides = configOverridesFromEnv({
    OVERLAY_CONFIG_VERSION: '2',
    OVERLAY_CONFIG_PRESET: 'dpdp-strict',
    OVERLAY_COMPLIANCE_PROFILE: 'dpdp-strict',
    OVERLAY_MINOR_MODE: 'true',
    OVERLAY_ALLOW_EXTERNAL_PROCESSORS: 'false',
    OVERLAY_ALLOWED_PROCESSORS: 'models:openai,objectStorage:s3',
    OVERLAY_ALLOWED_REGIONS: 'in,ap-south-1',
    OVERLAY_DATA_RESIDENCY_REQUIRED: '1',
    OVERLAY_FEATURE_BROWSER_USE: 'false',
    OVERLAY_FEATURE_SANDBOXES: 'false',
    OVERLAY_FEATURE_ANALYTICS: 'false',
    OVERLAY_PROVIDER_SANDBOX: 'none',
    OVERLAY_PROVIDER_BROWSER: 'none',
    OVERLAY_PROVIDER_WEB_SEARCH: 'none',
    OVERLAY_PROVIDER_ANALYTICS: 'none',
    OVERLAY_PROVIDER_DATABASE: 'convex',
    OVERLAY_PROVIDER_OBJECT_STORAGE: 's3',
    OVERLAY_PROVIDER_MODELS: 'openai',
  })

  assert.equal(overrides.configVersion, 2)
  assert.equal(overrides.preset, 'dpdp-strict')
  assert.deepEqual(overrides.features, {
    browserUse: false,
    sandboxes: false,
    analytics: false,
  })
  assert.deepEqual(overrides.providers, {
    database: { provider: 'convex' },
    objectStorage: { provider: 's3' },
    models: { provider: 'openai' },
    browser: { provider: 'none' },
    sandbox: { provider: 'none' },
    webSearch: { provider: 'none' },
    analytics: { provider: 'none' },
  })
  assert.deepEqual(overrides.compliance, {
    profile: 'dpdp-strict',
    minorMode: true,
    allowExternalProcessors: false,
    allowedProcessorIds: ['models:openai', 'objectStorage:s3'],
    dataResidency: {
      required: true,
      allowedRegions: ['in', 'ap-south-1'],
    },
  })
})

test('production env ignores dev WorkOS fallback variables', async () => {
  const config = await load({
    env: {
      OVERLAY_DEPLOYMENT_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'https://www.getoverlay.io',
      NEXT_PUBLIC_CONVEX_URL: 'https://colorful-chickadee-419.convex.cloud',
      CONVEX_DEPLOYMENT: 'prod:colorful-chickadee-419',
      WORKOS_CLIENT_ID: 'client_prod',
      WORKOS_API_KEY: 'workos_prod_secret',
      DEV_WORKOS_CLIENT_ID: 'client_dev_should_be_ignored',
      DEV_WORKOS_API_KEY: 'workos_dev_secret_should_be_ignored',
      ALLOW_DEV_AUTH_FALLBACKS: 'true',
      STRIPE_SECRET_KEY: 'sk_live_prod',
      STRIPE_WEBHOOK_SECRET: 'whsec_prod',
      STRIPE_PAID_UNIT_PRICE_ID: 'price_paid_prod',
      STRIPE_TOPUP_UNIT_PRICE_ID: 'price_topup_prod',
      STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_prod',
      INTERNAL_API_SECRET: 'internal_prod',
      INTERNAL_SERVICE_AUTH_SECRET: 'service_prod',
      API_KEY_HASH_SECRET: 'api_key_hash_prod',
    },
  })

  assert.equal(config.app.deploymentEnvironment, 'production')
  assert.equal(config.auth.allowDevFallbacks, false)
  assert.equal(config.auth.workos.clientId, 'client_prod')
  assert.equal(config.auth.workos.apiKey, 'workos_prod_secret')
  assert.equal(config.auth.workos.devClientId, undefined)
  assert.equal(config.auth.workos.devApiKey, undefined)
})

test('Vercel production keeps production env precedence even with Vercel app URLs', async () => {
  const config = await load({
    env: {
      VERCEL_ENV: 'production',
      VERCEL_URL: 'overlay-landing-git-main-example.vercel.app',
      NEXT_PUBLIC_APP_URL: 'https://www.getoverlay.io',
      NEXT_PUBLIC_CONVEX_URL: 'https://colorful-chickadee-419.convex.cloud',
      DEV_NEXT_PUBLIC_CONVEX_URL: 'https://different-caiman-77.convex.cloud',
      WORKOS_CLIENT_ID: 'client_prod',
      WORKOS_API_KEY: 'workos_prod_secret',
      DEV_WORKOS_CLIENT_ID: 'client_dev_should_be_ignored',
      DEV_WORKOS_API_KEY: 'workos_dev_secret_should_be_ignored',
      STRIPE_SECRET_KEY: 'sk_live_prod',
      DEV_STRIPE_SECRET_KEY: 'sk_test_dev',
      STRIPE_PAID_UNIT_PRICE_ID: 'price_paid_prod',
      DEV_STRIPE_PAID_UNIT_PRICE_ID: 'price_paid_dev',
      STRIPE_TOPUP_UNIT_PRICE_ID: 'price_topup_prod',
      DEV_STRIPE_TOPUP_UNIT_PRICE_ID: 'price_topup_dev',
      INTERNAL_API_SECRET: 'internal_prod',
      INTERNAL_SERVICE_AUTH_SECRET: 'service_prod',
      API_KEY_HASH_SECRET: 'api_key_hash_prod',
    },
  })

  assert.equal(config.app.deploymentEnvironment, 'production')
  assert.equal(config.billing.stripe.secretKey, 'sk_live_prod')
  assert.equal(config.billing.stripe.paidUnitPriceId, 'price_paid_prod')
  assert.equal(config.billing.stripe.topupUnitPriceId, 'price_topup_prod')
  assert.equal(config.database.convexUrl, 'https://colorful-chickadee-419.convex.cloud')
  assert.equal(config.auth.allowDevFallbacks, false)
})

test('loadOverlayConfig loads JSON override config', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'overlay-config-'))
  try {
    const configPath = path.join(dir, 'overlay.config.json')
    await writeFile(
      configPath,
      JSON.stringify({
        app: {
          baseUrl: 'https://json.getoverlay.io',
          deploymentEnvironment: 'staging',
        },
        billing: {
          stripe: {
            paidUnitPriceId: 'price_paid_json',
          },
        },
        capabilities: {
          webhooks: true,
        },
      }),
      'utf8',
    )

    const config = await load({ configFilePath: configPath })
    assert.equal(config.app.baseUrl, 'https://json.getoverlay.io')
    assert.equal(config.billing.stripe.paidUnitPriceId, 'price_paid_json')
    assert.equal(config.capabilities.webhooks, true)
    assert.equal(config.auth.workos.clientId, 'client_default')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadOverlayConfig precedence is env over JSON over default config', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'overlay-config-precedence-'))
  try {
    const configPath = path.join(dir, 'overlay.config.json')
    await writeFile(
      configPath,
      JSON.stringify({
        app: {
          baseUrl: 'https://json.getoverlay.io',
        },
        auth: {
          workos: {
            clientId: 'client_json',
          },
        },
      }),
      'utf8',
    )

    const config = await load({
      configFilePath: configPath,
      env: {
        OVERLAY_DEPLOYMENT_ENV: 'staging',
        NEXT_PUBLIC_APP_URL: 'https://env.getoverlay.io',
        WORKOS_CLIENT_ID: 'client_env',
      },
    })
    assert.equal(config.app.baseUrl, 'https://env.getoverlay.io')
    assert.equal(config.auth.workos.clientId, 'client_env')
    assert.equal(config.auth.workos.apiKey, 'workos_default_secret')
    assert.equal(config.billing.stripe.paidUnitPriceId, 'price_paid_default')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('redacted config summary does not expose secret values', async () => {
  const config = await load({
    env: {
      OVERLAY_DEPLOYMENT_ENV: 'staging',
      NEXT_PUBLIC_APP_URL: 'https://env.getoverlay.io',
      WORKOS_API_KEY: 'workos_env_secret',
      DEV_STRIPE_SECRET_KEY: 'sk_test_env_secret',
      R2_SECRET_ACCESS_KEY: 'r2_env_secret',
      INTERNAL_API_SECRET: 'internal_env_secret',
      INTERNAL_SERVICE_AUTH_SECRET: 'service_env_secret',
      API_KEY_HASH_SECRET: 'api_key_hash_env_secret',
      API_KEYS_ENABLED: '1',
    },
  })

  const redacted = JSON.stringify(getRedactedOverlayRuntimeConfigSummary(config))
  for (const secret of [
    'workos_env_secret',
    'sk_test_env_secret',
    'r2_env_secret',
    'internal_env_secret',
    'service_env_secret',
    'api_key_hash_env_secret',
  ]) {
    assert.equal(redacted.includes(secret), false)
  }
})

test('configOverridesFromEnv rejects secret-looking NEXT_PUBLIC values during parse', async () => {
  await assert.rejects(
    () =>
      load({
        env: {
          OVERLAY_DEPLOYMENT_ENV: 'staging',
          NEXT_PUBLIC_APP_URL: 'https://env.getoverlay.io',
          NEXT_PUBLIC_STRIPE_SECRET_KEY: 'sk_live_leaked',
        },
      }),
    (error) =>
      error instanceof Error &&
      'issues' in error &&
      Array.isArray(error.issues) &&
      error.issues.some((issue) => String(issue).includes('must not be public')),
  )

  const overrides = configOverridesFromEnv({
    NEXT_PUBLIC_APP_URL: 'https://env.getoverlay.io',
  })
  const appOverrides = overrides.app as { publicEnv?: Record<string, string> } | undefined
  assert.deepEqual(appOverrides?.publicEnv, {
    NEXT_PUBLIC_APP_URL: 'https://env.getoverlay.io',
  })
})

test('configOverridesFromEnv preserves auth provider selection shape', () => {
  assert.deepEqual(configOverridesFromEnv({
    KEYCLOAK_ISSUER_URL: 'https://keycloak.example.com/realms/overlay',
    KEYCLOAK_CLIENT_ID: 'overlay-web',
    KEYCLOAK_CLIENT_SECRET: 'keycloak_secret',
    KEYCLOAK_REALM: 'overlay',
  }).auth, {
    provider: 'oidc',
    allowDevFallbacks: false,
    workos: {},
    oidc: {
      issuerUrl: 'https://keycloak.example.com/realms/overlay',
      clientId: 'overlay-web',
    },
    keycloak: {
      issuerUrl: 'https://keycloak.example.com/realms/overlay',
      clientId: 'overlay-web',
      clientSecret: 'keycloak_secret',
      realm: 'overlay',
    },
  })

  assert.deepEqual(configOverridesFromEnv({
    OVERLAY_DEPLOYMENT_ENV: 'development',
    DEV_WORKOS_CLIENT_ID: 'dev_client',
    DEV_WORKOS_API_KEY: 'dev_secret',
  }).auth, {
    provider: 'workos',
    allowDevFallbacks: true,
    workos: {
      devClientId: 'dev_client',
      devApiKey: 'dev_secret',
    },
    oidc: {},
    keycloak: {},
  })
})

test('configOverridesFromEnv preserves deployment-specific billing and database env precedence', () => {
  const config = configOverridesFromEnv({
    OVERLAY_DEPLOYMENT_ENV: 'development',
    STRIPE_SECRET_KEY: 'sk_live_prod',
    DEV_STRIPE_SECRET_KEY: 'sk_test_dev',
    STRIPE_PAID_UNIT_PRICE_ID: 'price_prod',
    DEV_STRIPE_PAID_UNIT_PRICE_ID: 'price_dev',
    NEXT_PUBLIC_CONVEX_URL: 'https://prod.convex.cloud',
    DEV_NEXT_PUBLIC_CONVEX_URL: 'https://dev.convex.cloud',
  })

  assert.deepEqual(config.billing, {
    provider: 'stripe',
    stripe: {
      mode: 'test',
      secretKey: 'sk_test_dev',
      paidUnitPriceId: 'price_dev',
    },
  })
  assert.deepEqual(config.database, {
    provider: 'convex',
    convexUrl: 'https://dev.convex.cloud',
  })
})
