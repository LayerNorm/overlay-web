import 'server-only'

import overlayAppConfig from '@/overlay.config'
import { NoOpLLMGateway, OpenAILLMGateway, OpenRouterGateway } from '@/server/ai/providers'
import { ApiKeyService } from '@/server/auth/api-keys'
import {
  BetterAuthProvider,
  NoOpAuthProvider,
  OidcAuthProvider,
  WorkOSAuthProvider,
} from '@/server/auth/providers'
import { NoOpBillingProvider } from '@/server/billing/providers/noop-billing-provider'
import { StripeBillingProvider } from '@/server/billing/providers/stripe-billing-provider'
import { getOverlayRuntimeConfigSync, OverlayConfigError } from '@/server/config'
import { ConvexRateLimiter } from '@/server/shared/providers/convex-rate-limiter'
import { InMemoryEventBus } from '@/server/shared/providers/in-memory-event-bus'
import { InMemoryRateLimiter } from '@/server/shared/providers/in-memory-rate-limiter'
import {
  RedisRateLimiter,
  TcpRedisRateLimitStore,
  UpstashRedisRateLimitStore,
} from '@/server/shared/providers/redis-rate-limiter'
import { ConvexVectorStore } from '@/server/storage/providers/convex-vector-store'
import { InMemoryVectorStore } from '@/server/storage/providers/in-memory-vector-store'
import { NoOpObjectStore } from '@/server/storage/providers/noop-object-store'
import { R2ObjectStore } from '@/server/storage/providers/r2-object-store'
import { S3CompatibleObjectStore } from '@/server/storage/providers/s3-compatible-object-store'
import type { AppDataCapabilities } from '@/server/app-data/capabilities'
import { createAppDataContext, type AppDataContext } from '@/server/app-data/repositories'
import { createActUsagePolicy, type ActUsagePolicy } from '@/server/conversations/ActUsagePolicy'
import {
  createGenerationUsagePolicy,
  type GenerationUsagePolicy,
} from '@/server/outputs/GenerationUsagePolicy'
import { UserService, type UserAuthProvider } from '@/server/users'
import type { NoteRepository } from '@/server/notes'
import { MemoryService } from '@/server/memory'
import {
  KnowledgeSearchService,
  PostgresKnowledgeSearchRepository,
  UnavailableKnowledgeSearchRepository,
  createEmbeddingProvider,
} from '@/server/knowledge'
import { ConvexKnowledgeSearchRepository } from '@/server/knowledge/ConvexKnowledgeSearchRepository'
import type { OverlayRuntimeConfig } from '@/shared/config'
import { AnthropicGateway } from '@overlay/llm-gateway/anthropic'
import { GroqGateway } from '@overlay/llm-gateway/groq'
import { BUILT_IN_MODELS } from '@overlay/llm-gateway/models'
import type {
  AuthProvider,
  BillingProvider,
  CapabilityCheck,
  LLMGateway,
  ObjectStore,
  OverlayAppConfig,
  OverlayServerContext as OverlayProviderContext,
  RateLimiter,
  VectorStore,
} from '@overlay/app-core'
import { deriveOverlayCapabilities as resolveOverlayCapabilities } from '@overlay/app-core'

export interface OverlayServerContext extends OverlayProviderContext {
  appData: AppDataContext
  appDataCapabilities: AppDataCapabilities
  chatUsagePolicy: ActUsagePolicy
  generationUsagePolicy: GenerationUsagePolicy
  memoryService: MemoryService
  knowledgeSearchService: KnowledgeSearchService
  noteRepository: NoteRepository
  apiKeyService: typeof ApiKeyService
  userService: UserService
}

export interface CreateOverlayServerContextOptions {
  appConfig?: OverlayAppConfig
  runtimeConfig?: OverlayRuntimeConfig
}

export function createOverlayServerContext(
  config?: OverlayAppConfig,
  runtimeConfig?: OverlayRuntimeConfig,
): OverlayServerContext
export function createOverlayServerContext(
  options?: CreateOverlayServerContextOptions,
): OverlayServerContext
export function createOverlayServerContext(
  input: OverlayAppConfig | CreateOverlayServerContextOptions = overlayAppConfig,
  runtimeConfigArg?: OverlayRuntimeConfig,
): OverlayServerContext {
  const { appConfig, runtimeConfig } = normalizeCreateContextInput(input, runtimeConfigArg)

  if (runtimeConfig) {
    assertSelectedProviderConfig(runtimeConfig)
  }
  const appData = createAppDataContext(runtimeConfig)
  const chatUsagePolicy = createActUsagePolicy({
    appDataProvider: appData.capabilities.provider,
    repository: appData.repositories.conversations,
    runtimeConfig,
  })
  const generationUsagePolicy = createGenerationUsagePolicy({
    appDataProvider: appData.capabilities.provider,
    repository: appData.repositories.conversations,
    runtimeConfig,
    unlimitedEntitlements: chatUsagePolicy,
  })
  const userService = new UserService({
    authProvider: selectedAuthProviderForUserService(runtimeConfig),
    repository: appData.repositories.users,
  })
  const memoryService = new MemoryService(appData.repositories.memories)
  const knowledgeSearchService = createKnowledgeSearchService(appData, runtimeConfig)

  return {
    auth: appConfig.authProvider ?? createAuthProvider(runtimeConfig, userService),
    billing: appConfig.billingProvider ?? createBillingProvider(runtimeConfig),
    objectStore: appConfig.objectStore ?? createObjectStoreForRuntime(runtimeConfig),
    vectorStore: appConfig.vectorStore ?? createVectorStore(runtimeConfig),
    llmGateway: appConfig.llmGateway ?? createLlmGateway(runtimeConfig),
    rateLimiter: appConfig.rateLimiter ?? createRateLimiter(runtimeConfig),
    eventBus: appConfig.eventBus ?? new InMemoryEventBus(),
    appData,
    appDataCapabilities: appData.capabilities,
    chatUsagePolicy,
    generationUsagePolicy,
    memoryService,
    knowledgeSearchService,
    noteRepository: appData.repositories.notes,
    apiKeyService: ApiKeyService,
    userService,
  }
}

function createKnowledgeSearchService(
  appData: AppDataContext,
  runtimeConfig: OverlayRuntimeConfig | null,
): KnowledgeSearchService {
  if (appData.capabilities.provider !== 'postgres') {
    return new KnowledgeSearchService(new ConvexKnowledgeSearchRepository())
  }
  if (!runtimeConfig || !appData.capabilities.supportsVectorSearch) {
    return new KnowledgeSearchService(new UnavailableKnowledgeSearchRepository())
  }
  if (!appData.postgres) throw new Error('Postgres knowledge search requires a database context')
  return new KnowledgeSearchService(new PostgresKnowledgeSearchRepository({
    db: appData.postgres.db,
    embeddings: createEmbeddingProvider(runtimeConfig),
  }))
}

let defaultServerContext: OverlayServerContext | null = null

export function getOverlayServerContext(): OverlayServerContext {
  defaultServerContext ??= createOverlayServerContext(overlayAppConfig)
  return defaultServerContext
}

function normalizeCreateContextInput(
  input: OverlayAppConfig | CreateOverlayServerContextOptions,
  runtimeConfigArg?: OverlayRuntimeConfig,
): { appConfig: OverlayAppConfig; runtimeConfig: OverlayRuntimeConfig | null } {
  const hasOptionsShape =
    input !== null &&
    typeof input === 'object' &&
    ('appConfig' in input || 'runtimeConfig' in input)
  const appConfig = hasOptionsShape
    ? (input as CreateOverlayServerContextOptions).appConfig ?? overlayAppConfig
    : input as OverlayAppConfig
  const explicitRuntimeConfig = hasOptionsShape
    ? (input as CreateOverlayServerContextOptions).runtimeConfig
    : runtimeConfigArg

  if (explicitRuntimeConfig) {
    return { appConfig, runtimeConfig: explicitRuntimeConfig }
  }
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return { appConfig, runtimeConfig: null }
  }
  return { appConfig, runtimeConfig: getOverlayRuntimeConfigSync() }
}

function createAuthProvider(config: OverlayRuntimeConfig | null, userService: UserService): AuthProvider {
  if (!config) return new WorkOSAuthProvider()

  switch (selectedProvider(config, 'auth', config.auth.provider)) {
    case 'workos':
      return new WorkOSAuthProvider({
        ...config.auth.workos,
        allowDevFallbacks: config.auth.allowDevFallbacks,
      })
    case 'better-auth':
      return new BetterAuthProvider({ runtimeConfig: config, userService })
    case 'oidc':
      return new OidcAuthProvider(config.auth.oidc)
    case 'none':
      return new NoOpAuthProvider()
  }
  throw new OverlayConfigError('Overlay provider configuration is invalid', [
    `Unsupported auth provider: ${selectedProvider(config, 'auth', config.auth.provider)}`,
  ])
}

function selectedAuthProviderForUserService(config: OverlayRuntimeConfig | null): UserAuthProvider {
  const provider = config
    ? selectedProvider(config, 'auth', config.auth.provider)
    : 'workos'
  switch (provider) {
    case 'workos':
    case 'better-auth':
    case 'oidc':
    case 'none':
      return provider
  }
  return 'none'
}

function createBillingProvider(config: OverlayRuntimeConfig | null): BillingProvider {
  if (!config) return new StripeBillingProvider()
  if (!runtimeCapabilities(config).billing) return new NoOpBillingProvider()

  switch (config.billing.provider) {
    case 'stripe':
      return new StripeBillingProvider({
        ...config.billing.stripe,
        baseUrl: config.app.baseUrl,
      })
    case 'none':
      return new NoOpBillingProvider()
  }
  throw new OverlayConfigError('Overlay provider configuration is invalid', [
    `Unsupported billing provider: ${config.billing.provider}`,
  ])
}

export function createObjectStoreForRuntime(config: OverlayRuntimeConfig | null): ObjectStore {
  if (!config) return new R2ObjectStore()

  const storageProvider = selectedProvider(config, 'objectStorage', config.storage.provider)
  switch (storageProvider) {
    case 'r2':
      return new R2ObjectStore(config.storage.r2)
    case 's3':
      return new S3CompatibleObjectStore({
        provider: 's3',
        bucketName: config.storage.s3.bucketName ?? '',
        region: config.storage.s3.region ?? 'us-east-1',
        endpointUrl: config.storage.s3.endpointUrl,
        accessKeyId: config.storage.s3.accessKeyId ?? '',
        secretAccessKey: config.storage.s3.secretAccessKey ?? '',
        forcePathStyle: config.storage.s3.forcePathStyle,
      })
    case 'none':
      return new NoOpObjectStore()
  }
  throw new OverlayConfigError('Overlay provider configuration is invalid', [
    `Unsupported object storage provider: ${storageProvider}`,
  ])
}

function createVectorStore(config: OverlayRuntimeConfig | null): VectorStore {
  if (config && (!runtimeCapabilities(config).vectorSearch || selectedProvider(config, 'vectorSearch', 'convex') === 'none')) {
    return new InMemoryVectorStore()
  }
  return new ConvexVectorStore()
}

function createLlmGateway(config: OverlayRuntimeConfig | null): LLMGateway {
  if (!config) return new OpenRouterGateway()
  if (!runtimeCapabilities(config).modelRouting) return new NoOpLLMGateway()

  const modelProvider = selectedProvider(config, 'models', config.llm.gatewayProvider)
  switch (modelProvider) {
    case 'openrouter':
    case 'ai-gateway':
      return new OpenRouterGateway({
        gatewayProvider: modelProvider,
        apiKeyEnvVar: config.llm.apiKeyEnvVar,
        defaultChatModelId: config.llm.defaultChatModelId,
        modelAllowlist: config.llm.modelAllowlist,
      })
    case 'openai':
      return new OpenAILLMGateway({
        apiKeyEnvVar: config.llm.apiKeyEnvVar,
        defaultChatModelId: config.llm.defaultChatModelId,
        modelAllowlist: config.llm.modelAllowlist,
      })
    case 'anthropic':
      return new AnthropicGateway({
        getApiKey: () => resolveConfiguredEnvSecret(config.llm.apiKeyEnvVar ?? 'ANTHROPIC_API_KEY'),
        models: filterRuntimeModels(config.llm.modelAllowlist),
      })
    case 'groq':
      return new GroqGateway({
        getApiKey: () => resolveConfiguredEnvSecret(config.llm.apiKeyEnvVar ?? 'GROQ_API_KEY'),
        models: filterRuntimeModels(config.llm.modelAllowlist),
      })
    case 'none':
      return new NoOpLLMGateway()
  }
  throw new OverlayConfigError('Overlay provider configuration is invalid', [
    `Unsupported model provider: ${modelProvider}`,
  ])
}

function resolveConfiguredEnvSecret(envVarName: string): string | null {
  return process.env[envVarName]?.trim() || null
}

function filterRuntimeModels(modelAllowlist: readonly string[] | undefined) {
  if (!modelAllowlist?.length) return BUILT_IN_MODELS
  const allowed = new Set(modelAllowlist)
  return BUILT_IN_MODELS.filter((model) => allowed.has(model.id))
}

function createRateLimiter(config: OverlayRuntimeConfig | null): RateLimiter {
  const provider = config
    ? selectedProvider(config, 'rateLimit', config.app.deploymentEnvironment === 'onprem' ? 'memory' : 'convex')
    : 'convex'
  if (provider === 'memory' || provider === 'none') {
    return new InMemoryRateLimiter()
  }
  if (provider === 'redis') {
    const redis = config?.rateLimit.redis
    if (!redis) {
      throw new OverlayConfigError('Overlay provider configuration is invalid', [
        'rateLimit.redis configuration is required when rateLimit.provider is redis',
      ])
    }
    const prefix = redis.keyPrefix ?? 'overlay:rate-limit:'
    const store = redis.url
      ? new TcpRedisRateLimitStore(redis.url, prefix)
      : redis.restUrl && redis.restToken
        ? new UpstashRedisRateLimitStore(redis.restUrl, redis.restToken, prefix)
        : null
    if (!store) {
      throw new OverlayConfigError('Overlay provider configuration is invalid', [
        'Redis rate limiting requires a TCP URL or REST URL/token pair',
      ])
    }
    return new RedisRateLimiter({
      failureMode: redis.failureMode,
      store,
    })
  }
  return new ConvexRateLimiter()
}

function assertSelectedProviderConfig(config: OverlayRuntimeConfig): void {
  const issues: string[] = []
  const capabilities = runtimeCapabilities(config)
  const authProvider = selectedProvider(config, 'auth', config.auth.provider)
  const storageProvider = selectedProvider(config, 'objectStorage', config.storage.provider)
  const modelProvider = selectedProvider(config, 'models', config.llm.gatewayProvider)
  const vectorSearchProvider = selectedProvider(config, 'vectorSearch', capabilities.vectorSearch ? 'convex' : 'none')
  const rateLimitProvider = selectedProvider(config, 'rateLimit', config.app.deploymentEnvironment === 'onprem' ? 'memory' : 'convex')

  if (authProvider === 'workos') {
    const clientId = config.auth.workos.clientId ??
      (config.auth.allowDevFallbacks ? config.auth.workos.devClientId : undefined)
    const apiKey = config.auth.workos.apiKey ??
      (config.auth.allowDevFallbacks ? config.auth.workos.devApiKey : undefined)
    if (!clientId) issues.push('auth.workos.clientId is required when auth.provider is workos')
    if (!apiKey) issues.push('auth.workos.apiKey is required when auth.provider is workos')
  }
  if (authProvider === 'oidc') {
    if (!config.auth.oidc.issuerUrl) issues.push('auth.oidc.issuerUrl is required when auth.provider is oidc')
    if (!config.auth.oidc.clientId) issues.push('auth.oidc.clientId is required when auth.provider is oidc')
  }
  if (authProvider === 'better-auth') {
    if (!config.auth.betterAuth.secret) issues.push('auth.betterAuth.secret is required when auth.provider is better-auth')
    if (!config.auth.betterAuth.databaseUrl) issues.push('auth.betterAuth.databaseUrl is required when auth.provider is better-auth')
  }
  if (capabilities.billing && config.billing.provider === 'stripe' && !config.billing.stripe.secretKey) {
    issues.push('billing.stripe.secretKey is required when billing.provider is stripe')
  }
  if (storageProvider === 'r2') {
    const r2 = config.storage.r2
    if (!r2.bucketName) issues.push('storage.r2.bucketName is required when storage.provider is r2')
    if (!r2.accessKeyId) issues.push('storage.r2.accessKeyId is required when storage.provider is r2')
    if (!r2.secretAccessKey) issues.push('storage.r2.secretAccessKey is required when storage.provider is r2')
    if (!r2.endpointUrl && !r2.accountId) {
      issues.push('storage.r2.accountId or storage.r2.endpointUrl is required when storage.provider is r2')
    }
  }
  if (storageProvider === 's3') {
    const s3 = config.storage.s3
    if (!s3.bucketName) issues.push('storage.s3.bucketName is required when storage.provider is s3')
    if (!s3.region) issues.push('storage.s3.region is required when storage.provider is s3')
    if (!s3.accessKeyId) issues.push('storage.s3.accessKeyId is required when storage.provider is s3')
    if (!s3.secretAccessKey) issues.push('storage.s3.secretAccessKey is required when storage.provider is s3')
  }
  if (capabilities.modelRouting && modelProvider !== 'none' && config.llm.keySource === 'config') {
    issues.push('llm.keySource=config is reserved until encrypted runtime config secrets are implemented')
  }
  if (config.database.provider === 'postgres' || selectedProvider(config, 'database', config.database.provider) === 'postgres') {
    if (!config.database.postgres.connectionString) {
      issues.push('database.postgres.connectionString is required when database.provider is postgres')
    }
  }
  if (vectorSearchProvider !== 'convex' && vectorSearchProvider !== 'none') {
    issues.push(`providers.vectorSearch.provider=${vectorSearchProvider} is declared but not implemented. Use convex or none.`)
  }
  if (rateLimitProvider === 'redis') {
    const redis = config.rateLimit.redis
    if (!redis.url && !(redis.restUrl && redis.restToken)) {
      issues.push('rateLimit.redis requires a TCP URL or REST URL/token pair')
    }
  }

  if (issues.length > 0) {
    throw new OverlayConfigError('Overlay provider configuration is invalid', issues)
  }
}

function runtimeCapabilities(config: OverlayRuntimeConfig): CapabilityCheck {
  return resolveOverlayCapabilities(config)
}

function selectedProvider(
  config: OverlayRuntimeConfig,
  key: keyof NonNullable<OverlayRuntimeConfig['providers']>,
  fallback: string,
): string {
  const provider = config.providers[key]?.provider
  return provider ?? fallback
}
