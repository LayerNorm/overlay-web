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
  supportsSettings: boolean
  supportsOnboarding: boolean
  supportsUsageAccounting: boolean
  supportsBillingRecords: boolean
  supportsVectorSearch: boolean
  supportsAutomations: boolean
  supportsWebhooks: boolean
  supportsApiKeys: boolean
  supportsAccountDeletion: boolean
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
  supportsSettings: true,
  supportsOnboarding: true,
  supportsUsageAccounting: true,
  supportsBillingRecords: true,
  supportsVectorSearch: true,
  supportsAutomations: true,
  supportsWebhooks: true,
  supportsApiKeys: true,
  supportsAccountDeletion: true,
  requiresConvexClient: true,
}

export const POSTGRES_PHASE5_APP_DATA_CAPABILITIES: AppDataCapabilities = {
  provider: 'postgres',
  supportsRealtime: false,
  supportsStreamResume: false,
  supportsChatPersistence: true,
  supportsFileMetadata: false,
  supportsFileUploads: false,
  supportsNotes: false,
  supportsProjects: false,
  supportsSettings: true,
  supportsOnboarding: true,
  supportsUsageAccounting: false,
  supportsBillingRecords: false,
  supportsVectorSearch: false,
  supportsAutomations: false,
  supportsWebhooks: false,
  supportsApiKeys: false,
  supportsAccountDeletion: false,
  requiresConvexClient: false,
}

export function deriveAppDataCapabilities(
  runtimeConfig: OverlayRuntimeConfig | null,
): AppDataCapabilities {
  const provider = selectedDatabaseProvider(runtimeConfig)
  return provider === 'postgres'
    ? POSTGRES_PHASE5_APP_DATA_CAPABILITIES
    : CONVEX_APP_DATA_CAPABILITIES
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
    knowledge: capabilities.knowledge && appData.supportsVectorSearch,
    memory: capabilities.memory && appData.supportsVectorSearch,
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
