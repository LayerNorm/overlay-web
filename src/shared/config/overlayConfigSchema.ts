import { z } from 'zod'

export const OverlayDeploymentEnvironmentSchema = z.enum([
  'development',
  'test',
  'preview',
  'staging',
  'production',
  'onprem',
])

export const OverlayAuthProviderSchema = z.enum(['workos', 'better-auth', 'oidc', 'none'])
export const OverlayBillingProviderSchema = z.enum(['stripe', 'none'])
export const OverlayStorageProviderSchema = z.enum(['r2', 's3', 'none'])
export const OverlayLlmGatewayProviderSchema = z.enum([
  'openrouter',
  'ai-gateway',
  'openai',
  'anthropic',
  'groq',
  'none',
])
export const OverlayProviderKeySourceSchema = z.enum(['env', 'workos-vault', 'config', 'none'])
export const OverlayPublicUrlPolicySchema = z.enum(['proxy', 'presigned', 'public'])
export const OverlayStripeModeSchema = z.enum(['test', 'live', 'unknown'])
export const OverlayConfigPresetSchema = z.enum([
  'saas-default',
  'onprem-minimal',
  'enterprise-private',
  'dpdp-strict',
])
export const OverlayComplianceProfileSchema = z.enum([
  'saas-default',
  'onprem-minimal',
  'enterprise-private',
  'dpdp-strict',
  'custom',
])
export const OverlayDatabaseProviderSchema = z.enum(['convex', 'postgres'])
export const OverlayVectorSearchProviderSchema = z.enum(['convex', 'pgvector', 'pinecone', 'none'])
export const OverlayEmbeddingsProviderSchema = z.enum(['ai-gateway', 'openai', 'azure-openai', 'none'])
export const OverlayIntegrationsProviderSchema = z.enum(['composio', 'mcp', 'none'])
export const OverlayBrowserProviderSchema = z.enum(['browser-use', 'self-hosted-playwright', 'none'])
export const OverlaySandboxProviderSchema = z.enum(['daytona', 'e2b', 'local-firecracker', 'none'])
export const OverlayWebSearchProviderSchema = z.enum(['ai-gateway', 'perplexity', 'tavily', 'none'])
export const OverlayAnalyticsProviderSchema = z.enum(['posthog', 'none'])
export const OverlayErrorReportingProviderSchema = z.enum(['sentry', 'none'])
export const OverlaySecretsProviderSchema = z.enum(['env', 'workos-vault', 'aws-secrets-manager', 'vault', 'none'])
export const OverlayRateLimitProviderSchema = z.enum(['convex', 'redis', 'memory', 'none'])

const OverlayFeatureFlagsSchema = z
  .object({
    chat: z.boolean().optional(),
    files: z.boolean().optional(),
    memory: z.boolean().optional(),
    knowledge: z.boolean().optional(),
    automations: z.boolean().optional(),
    integrations: z.boolean().optional(),
    projects: z.boolean().optional(),
    skills: z.boolean().optional(),
    mcpServers: z.boolean().optional(),
    browserUse: z.boolean().optional(),
    sandboxes: z.boolean().optional(),
    webSearch: z.boolean().optional(),
    analytics: z.boolean().optional(),
    errorReporting: z.boolean().optional(),
    billing: z.boolean().optional(),
    webhooks: z.boolean().optional(),
    apiKeys: z.boolean().optional(),
    vectorSearch: z.boolean().optional(),
    modelRouting: z.boolean().optional(),
    sso: z.boolean().optional(),
    multiTenant: z.boolean().optional(),
  })
  .strict()

const OverlayComplianceSchema = z
  .object({
    profile: OverlayComplianceProfileSchema.default('saas-default'),
    minorMode: z.boolean().default(false),
    allowExternalProcessors: z.boolean().default(true),
    allowedProcessorIds: z.array(z.string().trim().min(1)).default([]),
    dataResidency: z
      .object({
        required: z.boolean().default(false),
        allowedRegions: z.array(z.string().trim().min(1)).default([]),
      })
      .default({}),
    retention: z
      .object({
        chatDays: z.number().int().positive().optional(),
        fileDays: z.number().int().positive().optional(),
        logsDays: z.number().int().positive().optional(),
        sandboxArtifactDays: z.number().int().positive().optional(),
        deletedUserPurgeDays: z.number().int().positive().optional(),
      })
      .default({}),
  })
  .strict()

const OverlayProvidersSchema = z
  .object({
    auth: z.object({ provider: OverlayAuthProviderSchema.optional() }).strict().optional(),
    database: z.object({ provider: OverlayDatabaseProviderSchema.optional() }).strict().optional(),
    objectStorage: z.object({ provider: OverlayStorageProviderSchema.optional() }).strict().optional(),
    vectorSearch: z.object({ provider: OverlayVectorSearchProviderSchema.optional() }).strict().optional(),
    embeddings: z.object({ provider: OverlayEmbeddingsProviderSchema.optional() }).strict().optional(),
    models: z.object({ provider: OverlayLlmGatewayProviderSchema.optional() }).strict().optional(),
    integrations: z.object({ provider: OverlayIntegrationsProviderSchema.optional() }).strict().optional(),
    browser: z.object({ provider: OverlayBrowserProviderSchema.optional() }).strict().optional(),
    sandbox: z.object({ provider: OverlaySandboxProviderSchema.optional() }).strict().optional(),
    webSearch: z.object({ provider: OverlayWebSearchProviderSchema.optional() }).strict().optional(),
    analytics: z.object({ provider: OverlayAnalyticsProviderSchema.optional() }).strict().optional(),
    errorReporting: z.object({ provider: OverlayErrorReportingProviderSchema.optional() }).strict().optional(),
    secrets: z.object({ provider: OverlaySecretsProviderSchema.optional() }).strict().optional(),
    rateLimit: z.object({ provider: OverlayRateLimitProviderSchema.optional() }).strict().optional(),
  })
  .strict()

const SecretLikePublicValuePattern =
  /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|ovl_sk_[A-Za-z0-9]|(?:api[_-]?key|secret|token)=/i

const OptionalStringSchema = z.string().trim().min(1).optional()
const OptionalUrlSchema = z.string().trim().url().optional()

export const OverlayRuntimeConfigSchema = z
  .object({
    configVersion: z.literal(2).default(2),
    preset: OverlayConfigPresetSchema.default('saas-default'),
    compliance: OverlayComplianceSchema.default({}),
    features: OverlayFeatureFlagsSchema.default({}),
    providers: OverlayProvidersSchema.default({}),
    app: z.object({
      baseUrl: z.string().trim().url(),
      deploymentEnvironment: OverlayDeploymentEnvironmentSchema,
      cspConnectSrc: z.array(z.string().trim().min(1)).default([]),
      publicEnv: z.record(z.string()).default({}),
    }),
    auth: z.object({
      provider: OverlayAuthProviderSchema,
      allowDevFallbacks: z.boolean().default(false),
      workos: z
        .object({
          clientId: OptionalStringSchema,
          apiKey: OptionalStringSchema,
          devClientId: OptionalStringSchema,
          devApiKey: OptionalStringSchema,
          jwksBaseUrl: OptionalUrlSchema,
        })
        .default({}),
      oidc: z
        .object({
          issuerUrl: OptionalUrlSchema,
          clientId: OptionalStringSchema,
          clientSecret: OptionalStringSchema,
          audience: OptionalStringSchema,
        })
        .default({}),
      betterAuth: z
        .object({
          baseUrl: OptionalUrlSchema,
          basePath: OptionalStringSchema,
          secret: OptionalStringSchema,
          databaseUrl: OptionalStringSchema,
          trustedOrigins: z.array(z.string().trim().url()).default([]),
          defaultSsoProviderId: OptionalStringSchema,
          defaultSsoDomain: OptionalStringSchema,
          oidcIssuerUrl: OptionalUrlSchema,
          oidcDiscoveryEndpoint: OptionalUrlSchema,
          oidcClientId: OptionalStringSchema,
          oidcClientSecret: OptionalStringSchema,
          jwtIssuer: OptionalUrlSchema,
          jwtAudience: OptionalStringSchema,
          jwksUrl: OptionalUrlSchema,
        })
        .default({}),
    }),
    billing: z.object({
      provider: OverlayBillingProviderSchema,
      stripe: z
        .object({
          mode: OverlayStripeModeSchema.default('unknown'),
          secretKey: OptionalStringSchema,
          webhookSecret: OptionalStringSchema,
          paidUnitPriceId: OptionalStringSchema,
          topupUnitPriceId: OptionalStringSchema,
          portalConfigurationId: OptionalStringSchema,
        })
        .default({}),
    }),
    storage: z.object({
      provider: OverlayStorageProviderSchema,
      publicUrlPolicy: OverlayPublicUrlPolicySchema.default('presigned'),
      r2: z
        .object({
          accountId: OptionalStringSchema,
          bucketName: OptionalStringSchema,
          accessKeyId: OptionalStringSchema,
          secretAccessKey: OptionalStringSchema,
          endpointUrl: OptionalUrlSchema,
          globalBudgetBytes: z.number().int().positive().optional(),
          presignTtlSeconds: z.number().int().positive().optional(),
        })
        .default({}),
      s3: z
        .object({
          bucketName: OptionalStringSchema,
          region: OptionalStringSchema,
          endpointUrl: OptionalUrlSchema,
          accessKeyId: OptionalStringSchema,
          secretAccessKey: OptionalStringSchema,
          forcePathStyle: z.boolean().optional(),
        })
        .default({}),
    }),
    llm: z.object({
      gatewayProvider: OverlayLlmGatewayProviderSchema,
      keySource: OverlayProviderKeySourceSchema.default('env'),
      defaultChatModelId: OptionalStringSchema,
      modelAllowlist: z.array(z.string().trim().min(1)).default([]),
      apiKeyEnvVar: OptionalStringSchema,
    }),
    database: z.object({
      provider: OverlayDatabaseProviderSchema.default('convex'),
      convexUrl: OptionalUrlSchema,
      deployment: OptionalStringSchema,
      internalApiSecret: OptionalStringSchema,
      internalServiceAuthSecret: OptionalStringSchema,
      apiKeyHashSecret: OptionalStringSchema,
      postgres: z
        .object({
          connectionString: OptionalStringSchema,
          sslMode: OptionalStringSchema,
        })
        .default({}),
    }),
    capabilities: z.object({
      billing: z.boolean().default(true),
      sso: z.boolean().default(true),
      apiKeys: z.boolean().default(false),
      webhooks: z.boolean().default(false),
      vectorSearch: z.boolean().default(true),
      automations: z.boolean().default(true),
      projects: z.boolean().default(true),
      skills: z.boolean().default(true),
      mcpServers: z.boolean().default(true),
      multiTenant: z.boolean().default(false),
    }),
  })
  .strict()
  .superRefine((config, ctx) => {
    const effectiveCapabilities = {
      ...config.capabilities,
      ...config.features,
    }
    const selectedProviders = {
      auth: config.providers.auth?.provider ?? config.auth.provider,
      database: config.providers.database?.provider ?? config.database.provider,
      objectStorage: config.providers.objectStorage?.provider ?? config.storage.provider,
      vectorSearch: config.providers.vectorSearch?.provider ?? (effectiveCapabilities.vectorSearch ? 'convex' : 'none'),
      embeddings: config.providers.embeddings?.provider ?? 'ai-gateway',
      models: config.providers.models?.provider ?? config.llm.gatewayProvider,
      integrations: config.providers.integrations?.provider ?? (effectiveCapabilities.integrations ? 'composio' : 'none'),
      browser: config.providers.browser?.provider ?? (effectiveCapabilities.browserUse ? 'browser-use' : 'none'),
      sandbox: config.providers.sandbox?.provider ?? (effectiveCapabilities.sandboxes ? 'daytona' : 'none'),
      webSearch: config.providers.webSearch?.provider ?? (effectiveCapabilities.webSearch ? 'ai-gateway' : 'none'),
      analytics: config.providers.analytics?.provider ?? (effectiveCapabilities.analytics ? 'posthog' : 'none'),
      errorReporting: config.providers.errorReporting?.provider ?? (effectiveCapabilities.errorReporting ? 'sentry' : 'none'),
      secrets: config.providers.secrets?.provider ?? 'env',
      rateLimit: config.providers.rateLimit?.provider ?? (config.app.deploymentEnvironment === 'onprem' ? 'memory' : 'convex'),
    }

    for (const [key, value] of Object.entries(config.app.publicEnv)) {
      if (!key.startsWith('NEXT_PUBLIC_')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['app', 'publicEnv', key],
          message: 'Only NEXT_PUBLIC_* keys may be listed in app.publicEnv',
        })
      }
      if (isSecretLikePublicValue(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['app', 'publicEnv', key],
          message: `${key} appears to contain a secret value and must not be public`,
        })
      }
    }

    if (selectedProviders.database === 'postgres' && !config.database.postgres.connectionString) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['database', 'postgres', 'connectionString'],
        message: 'database.postgres.connectionString is required when database.provider is postgres',
      })
    }
    if (selectedProviders.database === 'postgres' && config.billing.provider !== 'none') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billing', 'provider'],
        message: 'billing.provider must be none when database.provider is postgres until a Postgres usage backend is implemented',
      })
    }
    if (selectedProviders.database === 'postgres' && effectiveCapabilities.billing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capabilities', 'billing'],
        message: 'billing capability must be false when database.provider is postgres until a Postgres usage backend is implemented',
      })
    }
    addUnsupportedProviderIssue(ctx, ['providers', 'vectorSearch', 'provider'], selectedProviders.vectorSearch, {
      pgvector: 'pgvector is declared for enterprise config v2 but vector repository adapters are not implemented. Use vectorSearch.provider=convex or none.',
      pinecone: 'Pinecone is declared for enterprise config v2 but no Pinecone adapter exists yet. Use vectorSearch.provider=convex or none.',
    })
    addUnsupportedProviderIssue(ctx, ['providers', 'embeddings', 'provider'], selectedProviders.embeddings, {
      'azure-openai': 'Azure OpenAI embeddings are declared for enterprise config v2 but no embeddings adapter exists yet. Use embeddings.provider=ai-gateway, openai, or none.',
    })
    addUnsupportedProviderIssue(ctx, ['providers', 'integrations', 'provider'], selectedProviders.integrations, {
      mcp: 'MCP integration-provider bootstrap is declared but not implemented. Use integrations.provider=composio or none.',
    })
    addUnsupportedProviderIssue(ctx, ['providers', 'browser', 'provider'], selectedProviders.browser, {
      'self-hosted-playwright': 'Self-hosted Playwright is declared for enterprise config v2 but the browser adapter is not implemented. Use browser.provider=browser-use or none.',
    })
    addUnsupportedProviderIssue(ctx, ['providers', 'sandbox', 'provider'], selectedProviders.sandbox, {
      e2b: 'E2B sandboxes are declared for enterprise config v2 but no E2B adapter exists yet. Use sandbox.provider=daytona or none.',
      'local-firecracker': 'Local Firecracker sandboxes are declared for enterprise config v2 but no local sandbox adapter exists yet. Use sandbox.provider=daytona or none.',
    })
    addUnsupportedProviderIssue(ctx, ['providers', 'webSearch', 'provider'], selectedProviders.webSearch, {
      perplexity: 'Direct Perplexity web search is declared but not implemented. Use webSearch.provider=ai-gateway or none.',
      tavily: 'Tavily web search is declared but not implemented. Use webSearch.provider=ai-gateway or none.',
    })
    addUnsupportedProviderIssue(ctx, ['providers', 'secrets', 'provider'], selectedProviders.secrets, {
      'aws-secrets-manager': 'AWS Secrets Manager is declared but not implemented for runtime secret loading. Use secrets.provider=env or workos-vault.',
      vault: 'HashiCorp Vault is declared but not implemented for runtime secret loading. Use secrets.provider=env or workos-vault.',
    })
    addUnsupportedProviderIssue(ctx, ['providers', 'rateLimit', 'provider'], selectedProviders.rateLimit, {
      redis: 'Redis rate limiting is declared but not wired through enterprise config yet. Use rateLimit.provider=convex, memory, or none.',
    })

    if (config.preset === 'dpdp-strict' && config.compliance.profile !== 'dpdp-strict') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['compliance', 'profile'],
        message: 'preset=dpdp-strict requires compliance.profile=dpdp-strict',
      })
    }

    if (config.compliance.profile === 'dpdp-strict' && config.compliance.allowExternalProcessors === false) {
      assertExternalProcessorAllowed(ctx, config, 'integrations', selectedProviders.integrations, effectiveCapabilities.integrations, ['providers', 'integrations', 'provider'])
      assertExternalProcessorAllowed(ctx, config, 'browser', selectedProviders.browser, effectiveCapabilities.browserUse, ['providers', 'browser', 'provider'])
      assertExternalProcessorAllowed(ctx, config, 'sandbox', selectedProviders.sandbox, effectiveCapabilities.sandboxes, ['providers', 'sandbox', 'provider'])
      assertExternalProcessorAllowed(ctx, config, 'webSearch', selectedProviders.webSearch, effectiveCapabilities.webSearch, ['providers', 'webSearch', 'provider'])
      assertExternalProcessorAllowed(ctx, config, 'analytics', selectedProviders.analytics, effectiveCapabilities.analytics, ['providers', 'analytics', 'provider'])
      assertExternalProcessorAllowed(ctx, config, 'errorReporting', selectedProviders.errorReporting, effectiveCapabilities.errorReporting, ['providers', 'errorReporting', 'provider'])
    }

    if (config.billing.provider === 'none' && effectiveCapabilities.billing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capabilities', 'billing'],
        message: 'billing capability must be false when billing.provider is none',
      })
    }
    if (config.billing.provider === 'stripe' && !effectiveCapabilities.billing && config.features.billing !== false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billing', 'provider'],
        message: 'billing.provider must be none when billing capability is disabled',
      })
    }
    if (config.auth.provider === 'none' && effectiveCapabilities.sso) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capabilities', 'sso'],
        message: 'sso capability must be false when auth.provider is none',
      })
    }
    if (effectiveCapabilities.apiKeys && !config.database.apiKeyHashSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['database', 'apiKeyHashSecret'],
        message: 'API_KEY_HASH_SECRET is required when API key capability is enabled',
      })
    }
    if (effectiveCapabilities.multiTenant) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capabilities', 'multiTenant'],
        message: 'multiTenant cannot be enabled until the Phase 6b tenant isolation work is implemented',
      })
    }

    const stagingLikeAppUrl = isStagingLikeUrl(config.app.baseUrl)
    if (stagingLikeAppUrl && isLiveStripeSecret(config.billing.stripe.secretKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billing', 'stripe', 'secretKey'],
        message: 'Stripe live keys must not be used with staging or preview app URLs',
      })
    }

    if (selectedProviders.database === 'convex' && usesProductionConvex(config.database) && usesDevWorkOsConfig(config.auth.workos)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['auth', 'workos'],
        message: 'Production Convex must not be paired with DEV_WORKOS_* credentials',
      })
    }

    if (config.app.deploymentEnvironment === 'production') {
      if (!isHttpsUrl(config.app.baseUrl) || isLocalUrl(config.app.baseUrl) || stagingLikeAppUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['app', 'baseUrl'],
          message: 'Production app.baseUrl must be the canonical HTTPS production URL',
        })
      }
      if (config.auth.provider === 'workos') {
        if (!config.auth.workos.clientId || !config.auth.workos.apiKey) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['auth', 'workos'],
            message: 'Production WorkOS auth requires WORKOS_CLIENT_ID and WORKOS_API_KEY',
          })
        }
        if (config.auth.allowDevFallbacks || usesDevWorkOsConfig(config.auth.workos)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['auth', 'allowDevFallbacks'],
            message: 'Production auth must not allow dev WorkOS fallback credentials',
          })
        }
      }
      if (config.billing.provider === 'stripe') {
        if (!isLiveStripeSecret(config.billing.stripe.secretKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['billing', 'stripe', 'secretKey'],
            message: 'Production Stripe billing requires a live STRIPE_SECRET_KEY',
          })
        }
        if (!config.billing.stripe.webhookSecret) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['billing', 'stripe', 'webhookSecret'],
            message: 'Production Stripe billing requires STRIPE_WEBHOOK_SECRET',
          })
        }
      }
      if (selectedProviders.database === 'convex' && (!config.database.convexUrl || !usesProductionConvex(config.database))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['database', 'convexUrl'],
          message: 'Production requires the production Convex deployment URL',
        })
      }
      if (selectedProviders.database === 'postgres' && !config.database.postgres.connectionString) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['database', 'postgres', 'connectionString'],
          message: 'Production Postgres database provider requires database.postgres.connectionString',
        })
      }
      if (!config.database.internalApiSecret || !config.database.internalServiceAuthSecret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['database'],
          message: 'Production requires INTERNAL_API_SECRET and INTERNAL_SERVICE_AUTH_SECRET',
        })
      }
      if (
        config.database.internalApiSecret &&
        config.database.internalServiceAuthSecret &&
        config.database.internalApiSecret === config.database.internalServiceAuthSecret
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['database', 'internalServiceAuthSecret'],
          message: 'Production INTERNAL_SERVICE_AUTH_SECRET must differ from INTERNAL_API_SECRET',
        })
      }
    }
  })

export type OverlayRuntimeConfig = z.infer<typeof OverlayRuntimeConfigSchema>
export type OverlayRuntimeConfigInput = z.input<typeof OverlayRuntimeConfigSchema>
export type OverlayDeploymentEnvironment = z.infer<typeof OverlayDeploymentEnvironmentSchema>

export type OverlayRuntimeConfigPublicSummary = ReturnType<typeof redactOverlayRuntimeConfig>

export function parseOverlayRuntimeConfig(value: unknown): OverlayRuntimeConfig {
  return OverlayRuntimeConfigSchema.parse(value)
}

export function mergeOverlayRuntimeConfig(
  ...configs: Array<unknown | null | undefined>
): unknown {
  return configs.reduce<unknown>((merged, config) => deepMerge(merged, config ?? {}), {})
}

export function isRuntimeConfigSummaryVisible(config: OverlayRuntimeConfig): boolean {
  return config.app.deploymentEnvironment !== 'production'
}

export function redactOverlayRuntimeConfig(config: OverlayRuntimeConfig) {
  const effectiveCapabilities = {
    ...config.capabilities,
    ...config.features,
  }

  return {
    configVersion: config.configVersion,
    preset: config.preset,
    compliance: {
      profile: config.compliance.profile,
      minorMode: config.compliance.minorMode,
      allowExternalProcessors: config.compliance.allowExternalProcessors,
      allowedProcessorIds: [...config.compliance.allowedProcessorIds],
      dataResidency: {
        required: config.compliance.dataResidency.required,
        allowedRegions: [...config.compliance.dataResidency.allowedRegions],
      },
      retention: { ...config.compliance.retention },
    },
    features: { ...config.features },
    providers: cloneConfigValue(config.providers),
    app: {
      baseUrl: config.app.baseUrl,
      deploymentEnvironment: config.app.deploymentEnvironment,
      cspConnectSrc: [...config.app.cspConnectSrc],
      publicEnvKeys: Object.keys(config.app.publicEnv).sort(),
    },
    auth: {
      provider: config.auth.provider,
      allowDevFallbacks: config.auth.allowDevFallbacks,
      workos: {
        hasClientId: Boolean(config.auth.workos.clientId),
        hasApiKey: Boolean(config.auth.workos.apiKey),
        hasDevClientId: Boolean(config.auth.workos.devClientId),
        hasDevApiKey: Boolean(config.auth.workos.devApiKey),
        jwksBaseUrl: config.auth.workos.jwksBaseUrl,
      },
      oidc: {
        issuerUrl: config.auth.oidc.issuerUrl,
        hasClientId: Boolean(config.auth.oidc.clientId),
        hasClientSecret: Boolean(config.auth.oidc.clientSecret),
        hasAudience: Boolean(config.auth.oidc.audience),
      },
      betterAuth: {
        baseUrl: config.auth.betterAuth.baseUrl,
        basePath: config.auth.betterAuth.basePath,
        hasSecret: Boolean(config.auth.betterAuth.secret),
        hasDatabaseUrl: Boolean(config.auth.betterAuth.databaseUrl),
        trustedOrigins: [...config.auth.betterAuth.trustedOrigins],
        hasDefaultSsoProviderId: Boolean(config.auth.betterAuth.defaultSsoProviderId),
        hasDefaultSsoDomain: Boolean(config.auth.betterAuth.defaultSsoDomain),
        oidcIssuerUrl: config.auth.betterAuth.oidcIssuerUrl,
        oidcDiscoveryEndpoint: config.auth.betterAuth.oidcDiscoveryEndpoint,
        hasOidcClientId: Boolean(config.auth.betterAuth.oidcClientId),
        hasOidcClientSecret: Boolean(config.auth.betterAuth.oidcClientSecret),
        jwtIssuer: config.auth.betterAuth.jwtIssuer,
        hasJwtAudience: Boolean(config.auth.betterAuth.jwtAudience),
        jwksUrl: config.auth.betterAuth.jwksUrl,
      },
    },
    billing: {
      provider: config.billing.provider,
      stripe: {
        mode: config.billing.stripe.mode,
        hasSecretKey: Boolean(config.billing.stripe.secretKey),
        hasWebhookSecret: Boolean(config.billing.stripe.webhookSecret),
        hasPaidUnitPriceId: Boolean(config.billing.stripe.paidUnitPriceId),
        hasTopupUnitPriceId: Boolean(config.billing.stripe.topupUnitPriceId),
        hasPortalConfigurationId: Boolean(config.billing.stripe.portalConfigurationId),
      },
    },
    storage: {
      provider: config.storage.provider,
      publicUrlPolicy: config.storage.publicUrlPolicy,
      r2: {
        hasAccountId: Boolean(config.storage.r2.accountId),
        bucketName: config.storage.r2.bucketName,
        hasAccessKeyId: Boolean(config.storage.r2.accessKeyId),
        hasSecretAccessKey: Boolean(config.storage.r2.secretAccessKey),
        endpointUrl: config.storage.r2.endpointUrl,
        hasGlobalBudgetBytes: config.storage.r2.globalBudgetBytes !== undefined,
        presignTtlSeconds: config.storage.r2.presignTtlSeconds,
      },
      s3: {
        bucketName: config.storage.s3.bucketName,
        region: config.storage.s3.region,
        endpointUrl: config.storage.s3.endpointUrl,
        hasAccessKeyId: Boolean(config.storage.s3.accessKeyId),
        hasSecretAccessKey: Boolean(config.storage.s3.secretAccessKey),
        forcePathStyle: config.storage.s3.forcePathStyle,
      },
    },
    llm: {
      gatewayProvider: config.llm.gatewayProvider,
      keySource: config.llm.keySource,
      defaultChatModelId: config.llm.defaultChatModelId,
      modelAllowlist: [...config.llm.modelAllowlist],
      apiKeyEnvVar: config.llm.apiKeyEnvVar,
    },
    database: {
      provider: config.database.provider,
      convexUrl: config.database.convexUrl,
      deployment: config.database.deployment,
      hasInternalApiSecret: Boolean(config.database.internalApiSecret),
      hasInternalServiceAuthSecret: Boolean(config.database.internalServiceAuthSecret),
      hasApiKeyHashSecret: Boolean(config.database.apiKeyHashSecret),
      postgres: {
        hasConnectionString: Boolean(config.database.postgres.connectionString),
        sslMode: config.database.postgres.sslMode,
      },
    },
    tenancy: {
      mode: effectiveCapabilities.multiTenant ? 'shared-multi-tenant' : 'single-customer-deployment',
      boundary: effectiveCapabilities.multiTenant ? 'tenantId' : 'deployment',
      tenantSwitcherAvailable: false,
      phase6bRequiredForSharedDeployments: true,
    },
    capabilities: effectiveCapabilities,
  }
}

export function isSecretLikePublicValue(value: string): boolean {
  return SecretLikePublicValuePattern.test(value.trim())
}

export function isLiveStripeSecret(value: string | undefined): boolean {
  const normalized = value?.trim() ?? ''
  return normalized.startsWith('sk_live_') || normalized.startsWith('rk_live_')
}

export function inferStripeMode(value: string | undefined): z.infer<typeof OverlayStripeModeSchema> {
  const normalized = value?.trim() ?? ''
  if (normalized.startsWith('sk_live_') || normalized.startsWith('rk_live_')) return 'live'
  if (normalized.startsWith('sk_test_') || normalized.startsWith('rk_test_')) return 'test'
  return 'unknown'
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isLocalUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

function isStagingLikeUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return (
      hostname.includes('staging') ||
      hostname.includes('preview') ||
      hostname.includes('vercel.app') ||
      hostname.includes('localhost')
    )
  } catch {
    return false
  }
}

function usesProductionConvex(database: OverlayRuntimeConfig['database']): boolean {
  const deployment = database.deployment?.trim() ?? ''
  const convexUrl = database.convexUrl?.trim() ?? ''
  return deployment.startsWith('prod:') || convexUrl.includes('colorful-chickadee-419')
}

function usesDevWorkOsConfig(workos: OverlayRuntimeConfig['auth']['workos']): boolean {
  return Boolean(workos.devClientId || workos.devApiKey)
}

function addUnsupportedProviderIssue(
  ctx: z.RefinementCtx,
  path: Array<string | number>,
  selectedProvider: string | undefined,
  messages: Record<string, string>,
): void {
  if (!selectedProvider) return
  const message = messages[selectedProvider]
  if (!message) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message,
  })
}

function assertExternalProcessorAllowed(
  ctx: z.RefinementCtx,
  config: z.infer<typeof OverlayRuntimeConfigSchema>,
  processorId: string,
  provider: string | undefined,
  featureEnabled: boolean | undefined,
  path: Array<string | number>,
): void {
  if (!featureEnabled || !provider || provider === 'none') return
  const allowed = new Set(config.compliance.allowedProcessorIds)
  if (allowed.has(processorId) || allowed.has(provider) || allowed.has(`${processorId}:${provider}`)) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message: `dpdp-strict with allowExternalProcessors=false requires ${processorId} to be disabled, set to provider=none, or explicitly allowlisted in compliance.allowedProcessorIds.`,
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge(left: unknown, right: unknown): unknown {
  if (!isPlainObject(left)) return cloneConfigValue(right)
  if (!isPlainObject(right)) return cloneConfigValue(left)

  const merged: Record<string, unknown> = { ...left }
  for (const [key, value] of Object.entries(right)) {
    if (value === undefined) continue
    const existing = merged[key]
    merged[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? deepMerge(existing, value)
        : cloneConfigValue(value)
  }
  return merged
}

function cloneConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) return [...value]
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneConfigValue(entry)]))
  }
  return value
}
