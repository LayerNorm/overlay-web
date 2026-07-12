import {
  inferStripeMode,
  type OverlayDeploymentEnvironment,
  type OverlayRuntimeConfigInput,
} from '../../shared/config'

type EnvSource = Record<string, string | undefined>
type OverlayRuntimeConfigLayer = Record<string, unknown>

interface AuthEnvValues {
  betterAuthBasePath?: string
  betterAuthBaseUrl?: string
  betterAuthDatabaseUrl?: string
  betterAuthDefaultSsoDomain?: string
  betterAuthDefaultSsoProviderId?: string
  betterAuthJwksUrl?: string
  betterAuthJwtAudience?: string
  betterAuthJwtIssuer?: string
  betterAuthOidcClientId?: string
  betterAuthOidcClientSecret?: string
  betterAuthOidcDiscoveryEndpoint?: string
  betterAuthOidcIssuerUrl?: string
  betterAuthSecret?: string
  betterAuthTrustedOrigins?: string
  devWorkosApiKey?: string
  devWorkosClientId?: string
  oidcClientId?: string
  oidcIssuerUrl?: string
  provider?: string
  workosApiKey?: string
  workosClientId?: string
}

export function configOverridesFromEnv(env: EnvSource): OverlayRuntimeConfigLayer {
  const deploymentEnvironment = resolveDeploymentEnvironment(env)
  const appBaseUrl = resolveAppBaseUrl(env)
  const publicEnv = collectPublicEnv(env)
  const auth = authConfigFromEnv(env, deploymentEnvironment)
  const billing = billingConfigFromEnv(env, deploymentEnvironment)
  const storage = storageConfigFromEnv(env)
  const llm = llmConfigFromEnv(env)
  const database = databaseConfigFromEnv(env, deploymentEnvironment)
  const rateLimit = rateLimitConfigFromEnv(env)
  const capabilities = capabilitiesFromEnv(env)
  const features = featuresFromEnv(env)
  const compliance = complianceFromEnv(env)
  const providers = providersFromEnv(env)

  const config: OverlayRuntimeConfigLayer = {}
  const configVersion = readEnv(env, 'OVERLAY_CONFIG_VERSION')
  if (configVersion === '2') config.configVersion = 2
  const preset = readEnv(env, 'OVERLAY_CONFIG_PRESET')
  if (preset) config.preset = preset
  const cspConnectSrc = readEnv(env, 'OVERLAY_CSP_CONNECT_SRC')
  if (appBaseUrl || deploymentEnvironment || Object.keys(publicEnv).length > 0 || cspConnectSrc) {
    config.app = {
      ...(appBaseUrl ? { baseUrl: appBaseUrl } : {}),
      ...(deploymentEnvironment ? { deploymentEnvironment } : {}),
      ...(cspConnectSrc ? { cspConnectSrc: splitCsv(cspConnectSrc) } : {}),
      ...(Object.keys(publicEnv).length > 0 ? { publicEnv } : {}),
    }
  }
  if (auth) config.auth = auth
  if (billing) config.billing = billing
  if (storage) config.storage = storage
  if (llm) config.llm = llm
  if (database) config.database = database
  if (rateLimit) config.rateLimit = rateLimit
  if (Object.keys(capabilities).length > 0) config.capabilities = capabilities
  if (Object.keys(features).length > 0) config.features = features
  if (compliance) config.compliance = compliance
  if (Object.keys(providers).length > 0) config.providers = providers
  return config
}

function authConfigFromEnv(
  env: EnvSource,
  deploymentEnvironment?: OverlayDeploymentEnvironment,
): OverlayRuntimeConfigLayer | null {
  const values = readAuthEnv(env)
  const provider = values.provider ?? inferAuthProvider(values)
  if (!hasAnyAuthConfig(values, provider)) return null
  const isProduction = deploymentEnvironment === 'production'
  const allowDevFallbacks = isProduction
    ? false
    : readBool(env, 'ALLOW_DEV_AUTH_FALLBACKS') ??
      (deploymentEnvironment === 'development' || deploymentEnvironment === 'test')
  const betterAuth = compactObject({
    baseUrl: values.betterAuthBaseUrl,
    basePath: values.betterAuthBasePath,
    secret: values.betterAuthSecret,
    databaseUrl: values.betterAuthDatabaseUrl,
    trustedOrigins: values.betterAuthTrustedOrigins
      ? splitCsv(values.betterAuthTrustedOrigins)
      : undefined,
    defaultSsoProviderId: values.betterAuthDefaultSsoProviderId,
    defaultSsoDomain: values.betterAuthDefaultSsoDomain,
    oidcIssuerUrl: values.betterAuthOidcIssuerUrl,
    oidcDiscoveryEndpoint: values.betterAuthOidcDiscoveryEndpoint,
    oidcClientId: values.betterAuthOidcClientId,
    oidcClientSecret: values.betterAuthOidcClientSecret,
    jwtIssuer: values.betterAuthJwtIssuer,
    jwtAudience: values.betterAuthJwtAudience,
    jwksUrl: values.betterAuthJwksUrl,
  })

  return {
    ...(provider ? { provider: provider as OverlayRuntimeConfigInput['auth']['provider'] } : {}),
    allowDevFallbacks,
    workos: compactObject({
      clientId: values.workosClientId,
      apiKey: values.workosApiKey,
      devClientId: isProduction ? undefined : values.devWorkosClientId,
      devApiKey: isProduction ? undefined : values.devWorkosApiKey,
      jwksBaseUrl: readEnv(env, 'WORKOS_JWKS_BASE_URL'),
    }),
    oidc: compactObject({
      issuerUrl: values.oidcIssuerUrl,
      clientId: values.oidcClientId,
      clientSecret: readEnv(env, 'OIDC_CLIENT_SECRET'),
      audience: readEnv(env, 'OIDC_AUDIENCE'),
    }),
    ...(Object.keys(betterAuth).length > 0 ? { betterAuth } : {}),
  }
}

function billingConfigFromEnv(
  env: EnvSource,
  deploymentEnvironment?: OverlayDeploymentEnvironment,
): OverlayRuntimeConfigLayer | null {
  const secretKey = deploymentEnvironment === 'production'
    ? readEnv(env, 'STRIPE_SECRET_KEY')
    : readEnv(env, 'DEV_STRIPE_SECRET_KEY') ?? readEnv(env, 'STRIPE_SECRET_KEY')
  const webhookSecret = deploymentEnvironment === 'production'
    ? readEnv(env, 'STRIPE_WEBHOOK_SECRET')
    : readEnv(env, 'DEV_STRIPE_WEBHOOK_SECRET') ?? readEnv(env, 'STRIPE_WEBHOOK_SECRET')
  const provider = readEnv(env, 'BILLING_PROVIDER') ?? (secretKey ? 'stripe' : undefined)

  if (!provider && !secretKey && !webhookSecret) return null

  return {
    ...(provider ? { provider: provider as OverlayRuntimeConfigInput['billing']['provider'] } : {}),
    stripe: compactObject({
      mode: inferStripeMode(secretKey),
      secretKey,
      webhookSecret,
      paidUnitPriceId: resolveStripePriceEnv(
        env,
        deploymentEnvironment,
        'STRIPE_PAID_UNIT_PRICE_ID',
        'DEV_STRIPE_PAID_UNIT_PRICE_ID',
      ),
      topupUnitPriceId: resolveStripePriceEnv(
        env,
        deploymentEnvironment,
        'STRIPE_TOPUP_UNIT_PRICE_ID',
        'DEV_STRIPE_TOPUP_UNIT_PRICE_ID',
      ),
      portalConfigurationId: resolveStripePriceEnv(
        env,
        deploymentEnvironment,
        'STRIPE_PORTAL_CONFIGURATION_ID',
        'DEV_STRIPE_PORTAL_CONFIGURATION_ID',
      ),
    }),
  }
}

function storageConfigFromEnv(env: EnvSource): OverlayRuntimeConfigLayer | null {
  const provider =
    readEnv(env, 'STORAGE_PROVIDER') ??
    (readEnv(env, 'R2_BUCKET_NAME') || readEnv(env, 'R2_ACCOUNT_ID') ? 'r2' : undefined)
  if (!provider && !readEnv(env, 'R2_BUCKET_NAME')) return null

  return {
    ...(provider ? { provider: provider as OverlayRuntimeConfigInput['storage']['provider'] } : {}),
    ...(readEnv(env, 'STORAGE_PUBLIC_URL_POLICY')
      ? {
          publicUrlPolicy: readEnv(env, 'STORAGE_PUBLIC_URL_POLICY') as OverlayRuntimeConfigInput['storage']['publicUrlPolicy'],
        }
      : {}),
    r2: compactObject({
      accountId: readEnv(env, 'R2_ACCOUNT_ID'),
      bucketName: readEnv(env, 'R2_BUCKET_NAME'),
      accessKeyId: readEnv(env, 'R2_ACCESS_KEY_ID'),
      secretAccessKey: readEnv(env, 'R2_SECRET_ACCESS_KEY'),
      endpointUrl: readEnv(env, 'S3_API'),
      globalBudgetBytes: readNumber(env, 'R2_GLOBAL_BUDGET_BYTES'),
      presignTtlSeconds: readNumber(env, 'R2_PRESIGN_TTL_SECONDS'),
    }),
    s3: compactObject({
      bucketName: readEnv(env, 'S3_BUCKET_NAME'),
      region: readEnv(env, 'S3_REGION'),
      endpointUrl: readEnv(env, 'S3_ENDPOINT_URL'),
      accessKeyId: readEnv(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: readEnv(env, 'S3_SECRET_ACCESS_KEY'),
      forcePathStyle: readBool(env, 'S3_FORCE_PATH_STYLE'),
      presignTtlSeconds: readNumber(env, 'S3_PRESIGN_TTL_SECONDS'),
    }),
  }
}

function llmConfigFromEnv(env: EnvSource): OverlayRuntimeConfigLayer | null {
  const gatewayProvider =
    readEnv(env, 'LLM_GATEWAY') ??
    (readEnv(env, 'AI_GATEWAY_API_KEY')
      ? 'ai-gateway'
      : readEnv(env, 'OPENROUTER_API_KEY')
        ? 'openrouter'
        : readEnv(env, 'OPENAI_API_KEY')
          ? 'openai'
          : undefined)
  if (!gatewayProvider && !readEnv(env, 'DEFAULT_CHAT_MODEL_ID') && !readEnv(env, 'LLM_MODEL_ALLOWLIST')) {
    return null
  }

  return compactObject({
    gatewayProvider: gatewayProvider as OverlayRuntimeConfigInput['llm']['gatewayProvider'] | undefined,
    keySource: readEnv(env, 'LLM_KEY_SOURCE') as OverlayRuntimeConfigInput['llm']['keySource'] | undefined,
    defaultChatModelId: readEnv(env, 'DEFAULT_CHAT_MODEL_ID'),
    modelAllowlist: readEnv(env, 'LLM_MODEL_ALLOWLIST') ? splitCsv(readEnv(env, 'LLM_MODEL_ALLOWLIST')) : undefined,
    apiKeyEnvVar: readEnv(env, 'LLM_API_KEY_ENV_VAR'),
  })
}

function databaseConfigFromEnv(
  env: EnvSource,
  deploymentEnvironment?: OverlayDeploymentEnvironment,
): OverlayRuntimeConfigLayer | null {
  const provider = readEnv(env, 'OVERLAY_PROVIDER_DATABASE')
  const convexUrl = deploymentEnvironment === 'development'
    ? readEnv(env, 'DEV_NEXT_PUBLIC_CONVEX_URL') ?? readEnv(env, 'NEXT_PUBLIC_CONVEX_URL')
    : readEnv(env, 'NEXT_PUBLIC_CONVEX_URL') ?? readEnv(env, 'DEV_NEXT_PUBLIC_CONVEX_URL')
  const postgresConnectionString = readEnv(env, 'OVERLAY_DATABASE_URL')
  const postgresSslMode = readEnv(env, 'OVERLAY_DATABASE_SSL_MODE')

  if (
    !provider &&
    !convexUrl &&
    !postgresConnectionString &&
    !postgresSslMode &&
    !readEnv(env, 'CONVEX_DEPLOYMENT') &&
    !readEnv(env, 'INTERNAL_API_SECRET') &&
    !readEnv(env, 'INTERNAL_SERVICE_AUTH_SECRET') &&
    !readEnv(env, 'API_KEY_HASH_SECRET')
  ) {
    return null
  }

  const postgres = compactObject({
    connectionString: postgresConnectionString,
    sslMode: postgresSslMode,
  })

  return compactObject({
    provider: (provider ?? 'convex') as OverlayRuntimeConfigInput['database']['provider'] | undefined,
    convexUrl,
    deployment: readEnv(env, 'CONVEX_DEPLOYMENT'),
    internalApiSecret: readEnv(env, 'INTERNAL_API_SECRET'),
    internalServiceAuthSecret: readEnv(env, 'INTERNAL_SERVICE_AUTH_SECRET'),
    apiKeyHashSecret: readEnv(env, 'API_KEY_HASH_SECRET'),
    postgres: Object.keys(postgres).length > 0 ? postgres : undefined,
  })
}

function rateLimitConfigFromEnv(env: EnvSource): OverlayRuntimeConfigLayer | null {
  const redis = compactObject({
    url: readEnv(env, 'OVERLAY_REDIS_URL') ?? readEnv(env, 'REDIS_URL'),
    restUrl: readEnv(env, 'UPSTASH_REDIS_REST_URL'),
    restToken: readEnv(env, 'UPSTASH_REDIS_REST_TOKEN'),
    keyPrefix: readEnv(env, 'OVERLAY_REDIS_KEY_PREFIX'),
    failureMode: readEnv(env, 'OVERLAY_REDIS_FAILURE_MODE'),
  })
  return Object.keys(redis).length > 0 ? { redis } : null
}

function capabilitiesFromEnv(env: EnvSource): OverlayRuntimeConfigLayer {
  return compactObject({
    billing: readBool(env, 'OVERLAY_CAPABILITY_BILLING') ?? readBool(env, 'BILLING_ENABLED'),
    sso: readBool(env, 'OVERLAY_CAPABILITY_SSO'),
    apiKeys: readBool(env, 'API_KEYS_ENABLED'),
    webhooks: readBool(env, 'WEBHOOKS_ENABLED'),
    vectorSearch: readBool(env, 'VECTOR_SEARCH_ENABLED'),
    automations: readBool(env, 'AUTOMATIONS_ENABLED'),
    projects: readBool(env, 'PROJECTS_ENABLED'),
    skills: readBool(env, 'SKILLS_ENABLED'),
    mcpServers: readBool(env, 'MCP_SERVERS_ENABLED'),
    multiTenant: readBool(env, 'MULTI_TENANT_ENABLED'),
  })
}

function featuresFromEnv(env: EnvSource): OverlayRuntimeConfigLayer {
  return compactObject({
    chat: readFeatureBool(env, 'CHAT'),
    files: readFeatureBool(env, 'FILES'),
    memory: readFeatureBool(env, 'MEMORY'),
    knowledge: readFeatureBool(env, 'KNOWLEDGE'),
    automations: readFeatureBool(env, 'AUTOMATIONS') ?? readBool(env, 'AUTOMATIONS_ENABLED'),
    integrations: readFeatureBool(env, 'INTEGRATIONS'),
    projects: readFeatureBool(env, 'PROJECTS') ?? readBool(env, 'PROJECTS_ENABLED'),
    skills: readFeatureBool(env, 'SKILLS') ?? readBool(env, 'SKILLS_ENABLED'),
    mcpServers: readFeatureBool(env, 'MCP_SERVERS') ?? readBool(env, 'MCP_SERVERS_ENABLED'),
    browserUse: readFeatureBool(env, 'BROWSER_USE'),
    sandboxes: readFeatureBool(env, 'SANDBOXES'),
    webSearch: readFeatureBool(env, 'WEB_SEARCH'),
    analytics: readFeatureBool(env, 'ANALYTICS'),
    errorReporting: readFeatureBool(env, 'ERROR_REPORTING'),
    billing: readFeatureBool(env, 'BILLING') ?? readBool(env, 'BILLING_ENABLED'),
    webhooks: readFeatureBool(env, 'WEBHOOKS') ?? readBool(env, 'WEBHOOKS_ENABLED'),
    apiKeys: readFeatureBool(env, 'API_KEYS') ?? readBool(env, 'API_KEYS_ENABLED'),
    vectorSearch: readFeatureBool(env, 'VECTOR_SEARCH') ?? readBool(env, 'VECTOR_SEARCH_ENABLED'),
    modelRouting: readFeatureBool(env, 'MODEL_ROUTING'),
    sso: readFeatureBool(env, 'SSO'),
    multiTenant: readFeatureBool(env, 'MULTI_TENANT') ?? readBool(env, 'MULTI_TENANT_ENABLED'),
  })
}

function complianceFromEnv(env: EnvSource): OverlayRuntimeConfigLayer | null {
  const profile = readEnv(env, 'OVERLAY_COMPLIANCE_PROFILE')
  const minorMode = readBool(env, 'OVERLAY_MINOR_MODE')
  const allowExternalProcessors = readBool(env, 'OVERLAY_ALLOW_EXTERNAL_PROCESSORS')
  const allowedProcessorIds = readEnv(env, 'OVERLAY_ALLOWED_PROCESSORS')
  const dataResidencyRequired = readBool(env, 'OVERLAY_DATA_RESIDENCY_REQUIRED')
  const allowedRegions = readEnv(env, 'OVERLAY_ALLOWED_REGIONS')
  const retention = compactObject({
    chatDays: readNumber(env, 'OVERLAY_RETENTION_CHAT_DAYS'),
    fileDays: readNumber(env, 'OVERLAY_RETENTION_FILE_DAYS'),
    memoryDays: readNumber(env, 'OVERLAY_RETENTION_MEMORY_DAYS'),
    logsDays: readNumber(env, 'OVERLAY_RETENTION_LOGS_DAYS'),
    sandboxArtifactDays: readNumber(env, 'OVERLAY_RETENTION_SANDBOX_ARTIFACT_DAYS'),
    deletedUserPurgeDays: readNumber(env, 'OVERLAY_RETENTION_DELETED_USER_PURGE_DAYS'),
  })

  const dataResidency = compactObject({
    required: dataResidencyRequired,
    allowedRegions: allowedRegions ? splitCsv(allowedRegions) : undefined,
  })

  const compliance = compactObject({
    profile,
    minorMode,
    allowExternalProcessors,
    allowedProcessorIds: allowedProcessorIds ? splitCsv(allowedProcessorIds) : undefined,
    dataResidency: Object.keys(dataResidency).length > 0 ? dataResidency : undefined,
    retention: Object.keys(retention).length > 0 ? retention : undefined,
  })
  return Object.keys(compliance).length > 0 ? compliance : null
}

function providersFromEnv(env: EnvSource): OverlayRuntimeConfigLayer {
  const providers = compactObject({
    auth: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_AUTH') ?? readEnv(env, 'AUTH_PROVIDER')),
    database: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_DATABASE')),
    objectStorage: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_OBJECT_STORAGE')),
    vectorSearch: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_VECTOR_SEARCH')),
    embeddings: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_EMBEDDINGS')),
    models: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_MODELS') ?? readEnv(env, 'LLM_GATEWAY')),
    integrations: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_INTEGRATIONS')),
    browser: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_BROWSER')),
    sandbox: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_SANDBOX')),
    webSearch: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_WEB_SEARCH')),
    analytics: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_ANALYTICS')),
    errorReporting: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_ERROR_REPORTING')),
    secrets: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_SECRETS')),
    rateLimit: providerOverride(readEnv(env, 'OVERLAY_PROVIDER_RATE_LIMIT')),
  })
  return providers
}

function readAuthEnv(env: EnvSource): AuthEnvValues {
  return {
    provider: readEnv(env, 'AUTH_PROVIDER'),
    workosClientId: readEnv(env, 'WORKOS_CLIENT_ID'),
    workosApiKey: readEnv(env, 'WORKOS_API_KEY'),
    devWorkosClientId: readEnv(env, 'DEV_WORKOS_CLIENT_ID'),
    devWorkosApiKey: readEnv(env, 'DEV_WORKOS_API_KEY'),
    oidcIssuerUrl: readEnv(env, 'OIDC_ISSUER_URL'),
    oidcClientId: readEnv(env, 'OIDC_CLIENT_ID'),
    betterAuthBaseUrl: readEnv(env, 'BETTER_AUTH_URL') ?? readEnv(env, 'BETTER_AUTH_BASE_URL'),
    betterAuthBasePath: readEnv(env, 'BETTER_AUTH_BASE_PATH'),
    betterAuthSecret: readEnv(env, 'BETTER_AUTH_SECRET'),
    betterAuthDatabaseUrl: readEnv(env, 'BETTER_AUTH_DATABASE_URL'),
    betterAuthTrustedOrigins: readEnv(env, 'BETTER_AUTH_TRUSTED_ORIGINS'),
    betterAuthDefaultSsoProviderId: readEnv(env, 'BETTER_AUTH_DEFAULT_SSO_PROVIDER_ID'),
    betterAuthDefaultSsoDomain: readEnv(env, 'BETTER_AUTH_DEFAULT_SSO_DOMAIN'),
    betterAuthOidcIssuerUrl: readEnv(env, 'BETTER_AUTH_OIDC_ISSUER_URL'),
    betterAuthOidcDiscoveryEndpoint: readEnv(env, 'BETTER_AUTH_OIDC_DISCOVERY_ENDPOINT'),
    betterAuthOidcClientId: readEnv(env, 'BETTER_AUTH_OIDC_CLIENT_ID'),
    betterAuthOidcClientSecret: readEnv(env, 'BETTER_AUTH_OIDC_CLIENT_SECRET'),
    betterAuthJwtIssuer: readEnv(env, 'BETTER_AUTH_JWT_ISSUER'),
    betterAuthJwtAudience: readEnv(env, 'BETTER_AUTH_JWT_AUDIENCE'),
    betterAuthJwksUrl: readEnv(env, 'BETTER_AUTH_JWKS_URL'),
  }
}

function inferAuthProvider(values: AuthEnvValues): string | undefined {
  if (values.workosClientId || values.workosApiKey || values.devWorkosClientId || values.devWorkosApiKey) {
    return 'workos'
  }
  if (
    values.betterAuthBaseUrl ||
    values.betterAuthSecret ||
    values.betterAuthDatabaseUrl ||
    values.betterAuthDefaultSsoProviderId ||
    values.betterAuthDefaultSsoDomain ||
    values.betterAuthOidcIssuerUrl ||
    values.betterAuthOidcDiscoveryEndpoint ||
    values.betterAuthOidcClientId ||
    values.betterAuthOidcClientSecret ||
    values.betterAuthJwtIssuer ||
    values.betterAuthJwtAudience ||
    values.betterAuthJwksUrl
  ) {
    return 'better-auth'
  }
  return values.oidcIssuerUrl || values.oidcClientId ? 'oidc' : undefined
}

function hasAnyAuthConfig(values: AuthEnvValues, provider: string | undefined): boolean {
  return Boolean(
    provider ||
      values.workosClientId ||
      values.workosApiKey ||
      values.devWorkosClientId ||
      values.devWorkosApiKey ||
      values.oidcIssuerUrl ||
      values.oidcClientId ||
      values.betterAuthBaseUrl ||
      values.betterAuthSecret ||
      values.betterAuthDatabaseUrl ||
      values.betterAuthDefaultSsoProviderId ||
      values.betterAuthDefaultSsoDomain ||
      values.betterAuthOidcIssuerUrl ||
      values.betterAuthOidcDiscoveryEndpoint ||
      values.betterAuthOidcClientId ||
      values.betterAuthOidcClientSecret ||
      values.betterAuthJwtIssuer ||
      values.betterAuthJwtAudience ||
      values.betterAuthJwksUrl,
  )
}

function resolveAppBaseUrl(env: EnvSource): string | undefined {
  const configured = readEnv(env, 'NEXT_PUBLIC_APP_URL') ?? readEnv(env, 'DEV_NEXT_PUBLIC_APP_URL')
  if (configured) return configured

  const vercelUrl = readEnv(env, 'VERCEL_URL')
  return vercelUrl ? `https://${vercelUrl}` : undefined
}

function resolveDeploymentEnvironment(env: EnvSource): OverlayDeploymentEnvironment | undefined {
  const explicit = readEnv(env, 'OVERLAY_DEPLOYMENT_ENV')
  if (isDeploymentEnvironment(explicit)) return explicit

  const vercelEnv = readEnv(env, 'VERCEL_ENV')
  if (vercelEnv === 'production') return 'production'
  if (vercelEnv === 'preview') return 'preview'
  if (vercelEnv === 'development') return 'development'

  const appUrl = resolveAppBaseUrl(env)
  if (appUrl && /staging|preview|vercel\.app/i.test(appUrl)) return 'staging'

  const nodeEnv = readEnv(env, 'NODE_ENV')
  if (nodeEnv === 'test') return 'test'
  if (nodeEnv === 'development') return 'development'
  if (nodeEnv === 'production') return 'production'
  return undefined
}

function isDeploymentEnvironment(value: string | undefined): value is OverlayDeploymentEnvironment {
  return Boolean(
    value &&
      ['development', 'test', 'preview', 'staging', 'production', 'onprem'].includes(value),
  )
}

function resolveStripePriceEnv(
  env: EnvSource,
  deploymentEnvironment: OverlayDeploymentEnvironment | undefined,
  primary: string,
  dev: string,
): string | undefined {
  return deploymentEnvironment === 'production'
    ? readEnv(env, primary)
    : readEnv(env, dev) ?? readEnv(env, primary)
}

function collectPublicEnv(env: EnvSource): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(env)) {
    const value = rawValue?.trim()
    if (key.startsWith('NEXT_PUBLIC_') && value) out[key] = value
  }
  return out
}

function readEnv(env: EnvSource, name: string): string | undefined {
  const value = env[name]?.trim()
  return value ? value : undefined
}

function readBool(env: EnvSource, name: string): boolean | undefined {
  const value = readEnv(env, name)?.toLowerCase()
  if (value === undefined) return undefined
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return undefined
}

function readFeatureBool(env: EnvSource, featureName: string): boolean | undefined {
  return readBool(env, `OVERLAY_FEATURE_${featureName}`)
}

function readNumber(env: EnvSource, name: string): number | undefined {
  const value = readEnv(env, name)
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
  )
}

function providerOverride(provider: string | undefined): { provider: string } | undefined {
  return provider ? { provider } : undefined
}
