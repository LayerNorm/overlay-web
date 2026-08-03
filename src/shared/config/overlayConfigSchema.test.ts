import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OverlayRuntimeConfigSchema,
  redactOverlayRuntimeConfig,
  type OverlayRuntimeConfigInput,
} from './overlayConfigSchema'

const minimalSaasConfig = {
  app: {
    baseUrl: 'https://staging.getoverlay.io',
    deploymentEnvironment: 'staging',
    cspConnectSrc: ['https://different-caiman-77.convex.cloud'],
    publicEnv: {
      NEXT_PUBLIC_APP_URL: 'https://staging.getoverlay.io',
      NEXT_PUBLIC_CONVEX_URL: 'https://different-caiman-77.convex.cloud',
    },
  },
  auth: {
    provider: 'workos',
    allowDevFallbacks: false,
    workos: {
      clientId: 'client_staging',
      apiKey: 'workos_staging_secret',
    },
    oidc: {},
  },
  billing: {
    provider: 'stripe',
    stripe: {
      mode: 'test',
      secretKey: 'sk_test_staging',
      webhookSecret: 'whsec_staging',
      paidUnitPriceId: 'price_paid_staging',
      topupUnitPriceId: 'price_topup_staging',
      portalConfigurationId: 'bpc_staging',
    },
  },
  storage: {
    provider: 'r2',
    publicUrlPolicy: 'presigned',
    r2: {
      accountId: 'r2_account',
      bucketName: 'overlay-staging',
      accessKeyId: 'r2_access',
      secretAccessKey: 'r2_secret',
      endpointUrl: 'https://r2.example.com',
      globalBudgetBytes: 1000,
      presignTtlSeconds: 300,
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
    convexUrl: 'https://different-caiman-77.convex.cloud',
    deployment: 'dev:different-caiman-77',
    internalApiSecret: 'internal_staging',
    internalServiceAuthSecret: 'service_staging',
    apiKeyHashSecret: 'api_key_hash_staging',
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

function betterAuthConfig(connections: unknown[], betterAuthOverrides = {}) {
  return {
    ...minimalSaasConfig,
    auth: {
      provider: 'better-auth',
      allowDevFallbacks: false,
      workos: {},
      oidc: {},
      betterAuth: {
        secret: 'better_auth_session_secret',
        databaseUrl: 'postgresql://overlay_auth:secret@db.internal/overlay_auth',
        connections,
        ...betterAuthOverrides,
      },
    },
  }
}

test('OverlayRuntimeConfigSchema validates minimal SaaS config', () => {
  const parsed = OverlayRuntimeConfigSchema.parse(minimalSaasConfig)
  assert.equal(parsed.configVersion, 2)
  assert.equal(parsed.auth.provider, 'workos')
  assert.equal(parsed.billing.provider, 'stripe')
  assert.equal(parsed.storage.provider, 'r2')
  assert.equal(parsed.capabilities.apiKeys, true)
})

test('OverlayRuntimeConfigSchema validates the initial Better Auth connection presets', () => {
  const parsed = OverlayRuntimeConfigSchema.parse(betterAuthConfig([
    {
      id: 'workspace',
      preset: 'google-workspace',
      domains: ['School.EDU'],
      clientIdEnv: 'GOOGLE_WORKSPACE_CLIENT_ID',
      clientSecretEnv: 'GOOGLE_WORKSPACE_CLIENT_SECRET',
    },
    {
      id: 'auth0',
      preset: 'auth0',
      domains: ['partners.example.com'],
      issuerUrl: 'https://tenant.us.auth0.com',
      clientId: 'auth0-client',
      clientSecret: 'auth0-secret',
    },
    {
      id: 'microsoft',
      preset: 'entra-id',
      domains: ['corp.example.com'],
      tenantId: '4d38d1b7-5f35-4fd9-a522-8c85ec9ecb43',
      clientId: 'entra-client',
      clientSecret: 'entra-secret',
    },
    {
      id: 'custom',
      preset: 'generic-oidc',
      label: 'Continue with Enterprise SSO',
      domains: ['identity.example.org'],
      issuerUrl: 'https://idp.example.org',
      clientId: 'custom-client',
      clientSecret: 'custom-secret',
    },
  ], {
    accessPolicy: {
      requireVerifiedEmail: true,
      allowedEmailDomains: ['School.EDU', 'corp.example.com'],
    },
  }))

  assert.deepEqual(
    parsed.auth.betterAuth.connections.map((connection) => connection.preset),
    ['google-workspace', 'auth0', 'entra-id', 'generic-oidc'],
  )
  assert.deepEqual(parsed.auth.betterAuth.connections[0]?.domains, ['school.edu'])
  assert.deepEqual(parsed.auth.betterAuth.accessPolicy.allowedEmailDomains, [
    'school.edu',
    'corp.example.com',
  ])
})

test('OverlayRuntimeConfigSchema rejects unsafe Better Auth connection configuration', () => {
  assert.throws(
    () => OverlayRuntimeConfigSchema.parse(betterAuthConfig([
      {
        id: 'duplicate',
        preset: 'google-workspace',
        domains: ['example.com'],
        clientId: 'client-one',
        clientSecret: 'secret-one',
      },
      {
        id: 'duplicate',
        preset: 'generic-oidc',
        domains: ['example.org'],
        issuerUrl: 'https://idp.example.org',
        clientId: 'client-two',
        clientSecret: 'secret-two',
      },
    ])),
    /Duplicate Better Auth connection id/,
  )

  assert.throws(
    () => OverlayRuntimeConfigSchema.parse(betterAuthConfig([{
      id: 'microsoft',
      preset: 'entra-id',
      domains: ['example.com'],
      issuerUrl: 'https://login.microsoftonline.com/common/v2.0/',
      clientId: 'client',
      clientSecret: 'secret',
    }])),
    /tenant-specific issuer/,
  )

  assert.throws(
    () => OverlayRuntimeConfigSchema.parse(betterAuthConfig([{
      id: 'microsoft',
      preset: 'entra-id',
      domains: ['example.com'],
      issuerUrl: 'https://idp.example.com/customer/v2.0',
      clientId: 'client',
      clientSecret: 'secret',
    }])),
    /login\.microsoftonline\.com/,
  )

  assert.throws(
    () => OverlayRuntimeConfigSchema.parse(betterAuthConfig([{
      id: 'workspace',
      preset: 'google-workspace',
      domains: ['https://example.com'],
      clientId: 'client',
      clientSecret: 'secret',
    }])),
    /bare email domain/,
  )

  assert.throws(
    () => OverlayRuntimeConfigSchema.parse(betterAuthConfig([{
      id: 'workspace',
      preset: 'google-workspace',
      domains: ['example.com'],
      clientId: 'client',
      clientIdEnv: 'GOOGLE_CLIENT_ID',
      clientSecret: 'secret',
    }])),
    /Configure only one of clientId or clientIdEnv/,
  )
})

test('OverlayRuntimeConfigSchema rejects canonical and legacy Better Auth connections together', () => {
  assert.throws(
    () => OverlayRuntimeConfigSchema.parse(betterAuthConfig([{
      id: 'workspace',
      preset: 'google-workspace',
      domains: ['example.com'],
      clientId: 'client',
      clientSecret: 'secret',
    }], {
      defaultSsoProviderId: 'legacy',
      defaultSsoDomain: 'example.com',
      oidcIssuerUrl: 'https://legacy.example.com',
      oidcClientId: 'legacy-client',
      oidcClientSecret: 'legacy-secret',
    })),
    /Configure auth\.betterAuth\.connections or legacy/,
  )
})

test('OverlayRuntimeConfigSchema validates Executor integration provider configuration', () => {
  const parsed = OverlayRuntimeConfigSchema.parse({
    ...minimalSaasConfig,
    features: { integrations: true },
    providers: { integrations: { provider: 'executor' } },
    integrations: {
      executor: {
        apiBaseUrl: 'https://executor.internal.example.com/api',
        webBaseUrl: 'https://executor.example.com',
        mcpUrl: 'https://executor.internal.example.com/mcp',
        apiKey: 'executor-test-key',
        connectionOwner: 'org',
      },
    },
  } satisfies OverlayRuntimeConfigInput)
  assert.equal(parsed.providers.integrations?.provider, 'executor')
  assert.equal(parsed.integrations.executor.connectionOwner, 'org')
})

test('OverlayRuntimeConfigSchema rejects incomplete Executor integration configuration', () => {
  assert.throws(() => OverlayRuntimeConfigSchema.parse({
    ...minimalSaasConfig,
    features: { integrations: true },
    providers: { integrations: { provider: 'executor' } },
    integrations: { executor: { webBaseUrl: 'https://executor.example.com' } },
  }), /integrations\.executor\.apiBaseUrl is required/)
})

test('OverlayRuntimeConfigSchema validates v2 enterprise-private provider selections', () => {
  const parsed = OverlayRuntimeConfigSchema.parse({
    ...minimalSaasConfig,
    preset: 'enterprise-private',
    compliance: {
      profile: 'enterprise-private',
      minorMode: false,
      allowExternalProcessors: false,
      allowedProcessorIds: [],
    },
    auth: {
      ...minimalSaasConfig.auth,
      provider: 'oidc',
      workos: {},
      oidc: {
        issuerUrl: 'https://idp.enterprise.example.com',
        clientId: 'overlay',
      },
    },
    billing: {
      provider: 'none',
      stripe: {},
    },
    storage: {
      ...minimalSaasConfig.storage,
      provider: 's3',
      r2: {},
      s3: {
        bucketName: 'overlay-private',
        region: 'ap-south-1',
        accessKeyId: 's3_access',
        secretAccessKey: 's3_secret',
      },
    },
    llm: {
      ...minimalSaasConfig.llm,
      gatewayProvider: 'openai',
      apiKeyEnvVar: 'OPENAI_API_KEY',
    },
    features: {
      billing: false,
      integrations: false,
      browserUse: false,
      sandboxes: false,
      webSearch: false,
      analytics: false,
      errorReporting: false,
    },
    providers: {
      auth: { provider: 'oidc' },
      database: { provider: 'convex' },
      objectStorage: { provider: 's3' },
      vectorSearch: { provider: 'convex' },
      models: { provider: 'openai' },
      integrations: { provider: 'none' },
      browser: { provider: 'none' },
      sandbox: { provider: 'none' },
      webSearch: { provider: 'none' },
      analytics: { provider: 'none' },
      errorReporting: { provider: 'none' },
      secrets: { provider: 'env' },
      rateLimit: { provider: 'memory' },
    },
    capabilities: {
      ...minimalSaasConfig.capabilities,
      billing: false,
    },
  } satisfies OverlayRuntimeConfigInput)

  assert.equal(parsed.preset, 'enterprise-private')
  assert.equal(parsed.features.browserUse, false)
  assert.equal(parsed.providers.objectStorage?.provider, 's3')
})

test('OverlayRuntimeConfigSchema accepts configured Postgres database provider', () => {
  const parsed = OverlayRuntimeConfigSchema.parse({
    ...minimalSaasConfig,
    billing: {
      provider: 'none',
      stripe: {},
    },
    capabilities: {
      ...minimalSaasConfig.capabilities,
      billing: false,
      vectorSearch: false,
    },
    database: {
      ...minimalSaasConfig.database,
      provider: 'postgres',
      postgres: {
        connectionString: 'postgres://overlay:secret@db.internal/overlay',
        sslMode: 'require',
      },
    },
    providers: {
      database: { provider: 'postgres' },
      vectorSearch: { provider: 'none' },
    },
  })

  assert.equal(parsed.database.provider, 'postgres')
  assert.equal(parsed.providers.database?.provider, 'postgres')
  assert.equal(parsed.database.postgres.connectionString, 'postgres://overlay:secret@db.internal/overlay')
})

test('OverlayRuntimeConfigSchema accepts AWS Secrets Manager for Postgres BYOK', () => {
  const parsed = OverlayRuntimeConfigSchema.parse({
    ...minimalSaasConfig,
    billing: { provider: 'none', stripe: {} },
    capabilities: {
      ...minimalSaasConfig.capabilities,
      billing: false,
      vectorSearch: false,
    },
    database: {
      ...minimalSaasConfig.database,
      provider: 'postgres',
      postgres: {
        connectionString: 'postgres://overlay:secret@db.internal/overlay',
        sslMode: 'require',
      },
    },
    providers: {
      database: { provider: 'postgres' },
      secrets: { provider: 'aws-secrets-manager' },
      vectorSearch: { provider: 'none' },
    },
  })

  assert.equal(parsed.providers.secrets?.provider, 'aws-secrets-manager')
})

test('OverlayRuntimeConfigSchema accepts fail-closed Redis rate limiting for on-prem', () => {
  const parsed = OverlayRuntimeConfigSchema.parse({
    ...minimalSaasConfig,
    app: {
      ...minimalSaasConfig.app,
      deploymentEnvironment: 'onprem',
    },
    providers: {
      rateLimit: { provider: 'redis' },
    },
    rateLimit: {
      redis: {
        url: 'rediss://redis.internal:6379',
        failureMode: 'deny',
      },
    },
  })

  assert.equal(parsed.providers.rateLimit?.provider, 'redis')
  assert.equal(parsed.rateLimit.redis.failureMode, 'deny')
})

test('OverlayRuntimeConfigSchema rejects Redis without connectivity and fail-closed policy', () => {
  assert.throws(
    () => OverlayRuntimeConfigSchema.parse({
      ...minimalSaasConfig,
      app: {
        ...minimalSaasConfig.app,
        deploymentEnvironment: 'onprem',
      },
      providers: {
        rateLimit: { provider: 'redis' },
      },
      rateLimit: { redis: { failureMode: 'memory' } },
    }),
    /Redis rate limiting requires[\s\S]*failureMode=deny/,
  )
})

test('OverlayRuntimeConfigSchema rejects Postgres database provider with enabled vector search', () => {
  assert.throws(
    () =>
      OverlayRuntimeConfigSchema.parse({
        ...minimalSaasConfig,
        billing: {
          provider: 'none',
          stripe: {},
        },
        capabilities: {
          ...minimalSaasConfig.capabilities,
          billing: false,
        },
        database: {
          ...minimalSaasConfig.database,
          provider: 'postgres',
          postgres: {
            connectionString: 'postgres://overlay:secret@db.internal/overlay',
            sslMode: 'require',
          },
        },
        providers: {
          database: { provider: 'postgres' },
        },
      }),
    /Postgres vectorSearch requires providers\.vectorSearch\.provider=pgvector/,
  )
})

test('OverlayRuntimeConfigSchema rejects Postgres database provider with Convex vector search', () => {
  assert.throws(
    () =>
      OverlayRuntimeConfigSchema.parse({
        ...minimalSaasConfig,
        billing: {
          provider: 'none',
          stripe: {},
        },
        capabilities: {
          ...minimalSaasConfig.capabilities,
          billing: false,
          vectorSearch: false,
        },
        database: {
          ...minimalSaasConfig.database,
          provider: 'postgres',
          postgres: {
            connectionString: 'postgres://overlay:secret@db.internal/overlay',
            sslMode: 'require',
          },
        },
        providers: {
          database: { provider: 'postgres' },
          vectorSearch: { provider: 'convex' },
        },
      }),
    /Postgres vector search supports pgvector or none/,
  )
})

test('OverlayRuntimeConfigSchema accepts pgvector with Postgres and an embeddings provider', () => {
  const parsed = OverlayRuntimeConfigSchema.parse({
        ...minimalSaasConfig,
        billing: {
          provider: 'none',
          stripe: {},
        },
        capabilities: {
          ...minimalSaasConfig.capabilities,
          billing: false,
          vectorSearch: true,
        },
        database: {
          ...minimalSaasConfig.database,
          provider: 'postgres',
          postgres: {
            connectionString: 'postgres://overlay:secret@db.internal/overlay',
            sslMode: 'require',
          },
        },
        providers: {
          database: { provider: 'postgres' },
          vectorSearch: { provider: 'pgvector' },
          embeddings: { provider: 'openai' },
        },
      })
  assert.equal(parsed.providers.vectorSearch?.provider, 'pgvector')
  assert.equal(parsed.providers.embeddings?.provider, 'openai')
})

test('OverlayRuntimeConfigSchema accepts Postgres with Stripe billing records', () => {
  const parsed = OverlayRuntimeConfigSchema.parse({
    ...minimalSaasConfig,
    capabilities: {
      ...minimalSaasConfig.capabilities,
      vectorSearch: false,
    },
    database: {
      ...minimalSaasConfig.database,
      provider: 'postgres',
      postgres: {
        connectionString: 'postgres://overlay:secret@db.internal/overlay',
        sslMode: 'require',
      },
    },
    providers: {
      database: { provider: 'postgres' },
      vectorSearch: { provider: 'none' },
    },
  })
  assert.equal(parsed.billing.provider, 'stripe')
})

test('OverlayRuntimeConfigSchema rejects Postgres database provider without a connection string', () => {
  assert.throws(
    () =>
      OverlayRuntimeConfigSchema.parse({
        ...minimalSaasConfig,
        billing: {
          provider: 'none',
          stripe: {},
        },
        capabilities: {
          ...minimalSaasConfig.capabilities,
          billing: false,
          vectorSearch: false,
        },
        database: {
          ...minimalSaasConfig.database,
          provider: 'postgres',
        },
        providers: {
          database: { provider: 'postgres' },
          vectorSearch: { provider: 'none' },
        },
      }),
    /database\.postgres\.connectionString is required/,
  )
})

test('OverlayRuntimeConfigSchema rejects declared but unsupported providers', () => {
  assert.throws(
    () =>
      OverlayRuntimeConfigSchema.parse({
        ...minimalSaasConfig,
        providers: {
          sandbox: { provider: 'e2b' },
        },
      }),
    /E2B sandboxes are declared/,
  )
})

test('OverlayRuntimeConfigSchema rejects MinIO as a named storage provider', () => {
  assert.throws(
    () =>
      OverlayRuntimeConfigSchema.parse({
        ...minimalSaasConfig,
        storage: {
          ...minimalSaasConfig.storage,
          provider: 'minio',
        },
      }),
    /Invalid enum value[\s\S]*minio/,
  )
})

test('OverlayRuntimeConfigSchema rejects dpdp-strict external processors unless disabled or allowlisted', () => {
  assert.throws(
    () =>
      OverlayRuntimeConfigSchema.parse({
        ...minimalSaasConfig,
        preset: 'dpdp-strict',
        compliance: {
          profile: 'dpdp-strict',
          minorMode: true,
          allowExternalProcessors: false,
          allowedProcessorIds: [],
        },
        features: {
          browserUse: true,
        },
        providers: {
          browser: { provider: 'browser-use' },
        },
      }),
    /requires browser to be disabled/,
  )

  const parsed = OverlayRuntimeConfigSchema.parse({
    ...minimalSaasConfig,
    preset: 'dpdp-strict',
    compliance: {
      profile: 'dpdp-strict',
      minorMode: true,
      allowExternalProcessors: false,
      allowedProcessorIds: ['browser:browser-use'],
    },
    features: {
      browserUse: true,
      integrations: false,
      sandboxes: false,
      webSearch: false,
      analytics: false,
      errorReporting: false,
    },
    providers: {
      browser: { provider: 'browser-use' },
      integrations: { provider: 'none' },
      sandbox: { provider: 'none' },
      webSearch: { provider: 'none' },
      analytics: { provider: 'none' },
      errorReporting: { provider: 'none' },
    },
  } satisfies OverlayRuntimeConfigInput)
  assert.deepEqual(parsed.compliance.allowedProcessorIds, ['browser:browser-use'])
})

test('OverlayRuntimeConfigSchema validates on-prem OIDC/S3/OpenAI config with billing disabled', () => {
  const parsed = OverlayRuntimeConfigSchema.parse({
    app: {
      baseUrl: 'https://overlay.internal.example.com',
      deploymentEnvironment: 'onprem',
      cspConnectSrc: ['https://s3.internal.example.com'],
      publicEnv: {},
    },
    auth: {
      provider: 'oidc',
      allowDevFallbacks: false,
      workos: {},
      oidc: {
        issuerUrl: 'https://idp.internal.example.com/realms/overlay',
        clientId: 'overlay-web',
        clientSecret: 'oidc_secret',
        audience: 'overlay',
      },
    },
    billing: {
      provider: 'none',
      stripe: {},
    },
    storage: {
      provider: 's3',
      publicUrlPolicy: 'presigned',
      r2: {},
      s3: {
        bucketName: 'overlay',
        region: 'us-east-1',
        endpointUrl: 'https://s3.internal.example.com',
        accessKeyId: 's3_access',
        secretAccessKey: 's3_secret',
        forcePathStyle: true,
      },
    },
    llm: {
      gatewayProvider: 'openai',
      keySource: 'env',
      defaultChatModelId: 'gpt-4.1',
      modelAllowlist: ['gpt-4.1'],
      apiKeyEnvVar: 'OPENAI_API_KEY',
    },
    database: {
      provider: 'convex',
      convexUrl: 'https://overlay-onprem.convex.cloud',
      deployment: 'dev:onprem-overlay',
      internalApiSecret: 'internal_onprem',
      internalServiceAuthSecret: 'service_onprem',
    },
    capabilities: {
      billing: false,
      sso: true,
      apiKeys: false,
      webhooks: false,
      vectorSearch: true,
      automations: true,
      multiTenant: false,
    },
  } satisfies OverlayRuntimeConfigInput)

  assert.equal(parsed.auth.provider, 'oidc')
  assert.equal(parsed.billing.provider, 'none')
  assert.equal(parsed.storage.provider, 's3')
  assert.equal(parsed.llm.gatewayProvider, 'openai')
})

test('OverlayRuntimeConfigSchema rejects mixed production and staging credentials', () => {
  assert.throws(
    () =>
      OverlayRuntimeConfigSchema.parse({
        ...minimalSaasConfig,
        database: {
          ...minimalSaasConfig.database,
          convexUrl: 'https://colorful-chickadee-419.convex.cloud',
          deployment: 'prod:colorful-chickadee-419',
        },
        auth: {
          ...minimalSaasConfig.auth,
          workos: {
            ...minimalSaasConfig.auth.workos,
            devClientId: 'client_dev',
            devApiKey: 'workos_dev_secret',
          },
        },
      }),
    /Production Convex must not be paired with DEV_WORKOS/,
  )

  assert.throws(
    () =>
      OverlayRuntimeConfigSchema.parse({
        ...minimalSaasConfig,
        app: {
          ...minimalSaasConfig.app,
          baseUrl: 'https://staging.getoverlay.io',
        },
        billing: {
          ...minimalSaasConfig.billing,
          stripe: {
            ...minimalSaasConfig.billing.stripe,
            mode: 'live',
            secretKey: 'sk_live_should_not_be_on_staging',
          },
        },
      }),
    /Stripe live keys must not be used with staging/,
  )
})

test('OverlayRuntimeConfigSchema requires API_KEY_HASH_SECRET when API keys are enabled', () => {
  assert.throws(
    () =>
      OverlayRuntimeConfigSchema.parse({
        ...minimalSaasConfig,
        database: {
          ...minimalSaasConfig.database,
          apiKeyHashSecret: undefined,
        },
      }),
    /API_KEY_HASH_SECRET/,
  )
})

test('OverlayRuntimeConfigSchema rejects multiTenant until Phase 6b tenant isolation is implemented', () => {
  assert.throws(
    () =>
      OverlayRuntimeConfigSchema.parse({
        ...minimalSaasConfig,
        capabilities: {
          ...minimalSaasConfig.capabilities,
          multiTenant: true,
        },
      }),
    /multiTenant cannot be enabled until the Phase 6b tenant isolation work is implemented/,
  )
})

test('OverlayRuntimeConfigSchema rejects secret-looking values in NEXT_PUBLIC fields', () => {
  const publicSecretKey = ['NEXT_PUBLIC_STRIPE', 'SECRET_KEY'].join('_')

  assert.throws(
    () =>
      OverlayRuntimeConfigSchema.parse({
        ...minimalSaasConfig,
        app: {
          ...minimalSaasConfig.app,
          publicEnv: {
            NEXT_PUBLIC_APP_URL: 'https://staging.getoverlay.io',
            [publicSecretKey]: 'sk_live_leaked',
          },
        },
      }),
    /must not be public/,
  )
})

test('redactOverlayRuntimeConfig never returns secret values', () => {
  const parsed = OverlayRuntimeConfigSchema.parse(minimalSaasConfig)
  const summary = redactOverlayRuntimeConfig(parsed)
  const redacted = JSON.stringify(summary)

  assert.equal(redacted.includes('sk_test_staging'), false)
  assert.equal(redacted.includes('whsec_staging'), false)
  assert.equal(redacted.includes('internal_staging'), false)
  assert.equal(redacted.includes('api_key_hash_staging'), false)
  assert.equal(redacted.includes('workos_staging_secret'), false)
  assert.equal(redacted.includes('r2_secret'), false)
  assert.deepEqual(summary.tenancy, {
    mode: 'single-customer-deployment',
    boundary: 'deployment',
    tenantSwitcherAvailable: false,
    phase6bRequiredForSharedDeployments: true,
  })
})

test('redactOverlayRuntimeConfig exposes connection metadata without credentials', () => {
  const parsed = OverlayRuntimeConfigSchema.parse(betterAuthConfig([{
    id: 'workspace',
    preset: 'google-workspace',
    label: 'Continue with School Google',
    domains: ['school.edu'],
    clientId: 'private-google-client-id',
    clientSecret: 'private-google-client-secret',
  }]))
  const summary = redactOverlayRuntimeConfig(parsed)
  const redacted = JSON.stringify(summary)

  assert.equal(redacted.includes('private-google-client-id'), false)
  assert.equal(redacted.includes('private-google-client-secret'), false)
  assert.deepEqual(summary.auth.betterAuth.connections, [{
    id: 'workspace',
    protocol: 'oidc',
    preset: 'google-workspace',
    label: 'Continue with School Google',
    domains: ['school.edu'],
    issuerUrl: undefined,
    discoveryEndpoint: undefined,
    tenantId: undefined,
    hasClientId: true,
    hasClientSecret: true,
    clientIdEnv: undefined,
    clientSecretEnv: undefined,
  }])
})
