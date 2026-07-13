import 'server-only'

import type { CapabilityCheck } from '@overlay/app-core'
import type { OverlayRuntimeConfig } from '@/shared/config'

export type AppDataProvider = 'convex' | 'postgres'

export interface AppDataCapabilities {
  provider: AppDataProvider
  supportsRealtime: boolean
  supportsStreamResume: boolean
  supportsChatPersistence: boolean
  supportsFileMetadata: boolean
  supportsFileUploads: boolean
  supportsNotes: boolean
  supportsProjects: boolean
  supportsIntegrations: boolean
  supportsSkills: boolean
  supportsMcpServers: boolean
  supportsSettings: boolean
  supportsOnboarding: boolean
  supportsUsageAccounting: boolean
  supportsBillingRecords: boolean
  supportsVectorSearch: boolean
  supportsAutomations: boolean
  supportsWebhooks: boolean
  supportsApiKeys: boolean
  supportsAccountDeletion: boolean
  supportsBackgroundMaintenance: boolean
  supportsManagedScheduler: boolean
  supportsPersistentIdempotency: boolean
  supportsServiceAuthReplayStore: boolean
  requiresConvexClient: boolean
}

export const CONVEX_APP_DATA_CAPABILITIES: AppDataCapabilities = {
  provider: 'convex',
  supportsRealtime: true,
  supportsStreamResume: true,
  supportsChatPersistence: true,
  supportsFileMetadata: true,
  supportsFileUploads: true,
  supportsNotes: true,
  supportsProjects: true,
  supportsIntegrations: true,
  supportsSkills: true,
  supportsMcpServers: true,
  supportsSettings: true,
  supportsOnboarding: true,
  supportsUsageAccounting: true,
  supportsBillingRecords: true,
  supportsVectorSearch: true,
  supportsAutomations: true,
  supportsWebhooks: true,
  supportsApiKeys: true,
  supportsAccountDeletion: true,
  supportsBackgroundMaintenance: true,
  supportsManagedScheduler: true,
  supportsPersistentIdempotency: true,
  supportsServiceAuthReplayStore: true,
  requiresConvexClient: true,
}

export const POSTGRES_APP_DATA_V1_CAPABILITIES: AppDataCapabilities = {
  provider: 'postgres',
  supportsRealtime: true,
  supportsStreamResume: true,
  supportsChatPersistence: true,
  supportsFileMetadata: true,
  supportsFileUploads: true,
  supportsNotes: true,
  supportsProjects: true,
  supportsIntegrations: false,
  supportsSkills: false,
  supportsMcpServers: false,
  supportsSettings: true,
  supportsOnboarding: true,
  supportsUsageAccounting: true,
  supportsBillingRecords: true,
  supportsVectorSearch: false,
  supportsAutomations: true,
  supportsWebhooks: true,
  supportsApiKeys: false,
  supportsAccountDeletion: true,
  supportsBackgroundMaintenance: true,
  supportsManagedScheduler: true,
  supportsPersistentIdempotency: true,
  supportsServiceAuthReplayStore: true,
  requiresConvexClient: false,
}

export function deriveAppDataCapabilities(
  runtimeConfig: OverlayRuntimeConfig | null,
): AppDataCapabilities {
  const provider = selectedDatabaseProvider(runtimeConfig)
  if (provider !== 'postgres') return CONVEX_APP_DATA_CAPABILITIES
  const vectorProvider = runtimeConfig?.providers.vectorSearch?.provider
  const backgroundRuntimeEnabled =
    runtimeConfig?.database.postgres.backgroundRuntimeEnabled === true
  const serviceAuthConfigured = Boolean(
    runtimeConfig?.database.internalServiceAuthSecret?.trim(),
  )
  return {
    ...POSTGRES_APP_DATA_V1_CAPABILITIES,
    supportsAutomations: backgroundRuntimeEnabled && serviceAuthConfigured,
    supportsWebhooks: backgroundRuntimeEnabled,
    supportsVectorSearch:
      runtimeConfig?.capabilities.vectorSearch === true && vectorProvider === 'pgvector',
  }
}

export function applyAppDataCapabilitiesToOverlayCapabilities(
  capabilities: CapabilityCheck,
  appData: AppDataCapabilities,
): CapabilityCheck {
  if (appData.provider === 'convex') return capabilities
  return {
    ...capabilities,
    apiKeys: capabilities.apiKeys && appData.supportsApiKeys,
    automations: capabilities.automations && appData.supportsAutomations,
    files: capabilities.files && appData.supportsFileMetadata,
    integrations: capabilities.integrations && appData.supportsIntegrations,
    knowledge: capabilities.knowledge && (
      appData.supportsFileMetadata ||
      appData.supportsNotes ||
      appData.supportsVectorSearch
    ),
    memory: capabilities.memory && appData.supportsVectorSearch,
    mcpServers: capabilities.mcpServers && appData.supportsMcpServers,
    projects: capabilities.projects && appData.supportsProjects,
    skills: capabilities.skills && appData.supportsSkills,
    vectorSearch: capabilities.vectorSearch && appData.supportsVectorSearch,
    webhooks: capabilities.webhooks && appData.supportsWebhooks,
  }
}

export function selectedDatabaseProvider(
  runtimeConfig: OverlayRuntimeConfig | null,
): AppDataProvider {
  const provider = runtimeConfig
    ? runtimeConfig.providers.database?.provider ?? runtimeConfig.database.provider
    : 'convex'
  return provider === 'postgres' ? 'postgres' : 'convex'
}
