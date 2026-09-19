import 'server-only'

import type { CapabilityCheck } from '@overlay/app-core'
import type { OverlayRuntimeConfig } from '@/shared/config'

export type AppDataProvider = 'convex'

export interface AppDataCapabilities {
  provider: AppDataProvider
  supportsRealtime: boolean
  supportsStreamResume: boolean
  supportsChatPersistence: boolean
  supportsFileMetadata: boolean
  supportsFileUploads: boolean
  supportsNotes: boolean
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
  supportsConnectedAgents: boolean
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
  supportsConnectedAgents: true,
  requiresConvexClient: true,
}

export function deriveAppDataCapabilities(
  _runtimeConfig: OverlayRuntimeConfig | null,
): AppDataCapabilities {
  return CONVEX_APP_DATA_CAPABILITIES
}

export function applyAppDataCapabilitiesToOverlayCapabilities(
  capabilities: CapabilityCheck,
  _appData: AppDataCapabilities,
): CapabilityCheck {
  return capabilities
}

export function selectedDatabaseProvider(
  _runtimeConfig: OverlayRuntimeConfig | null,
): AppDataProvider {
  return 'convex'
}
