'use client'

import {
  createContext,
  useContext,
  useMemo,
} from 'react'
import {
  DEFAULT_OVERLAY_CAPABILITIES,
  type CapabilityCheck,
} from '@overlay/app-core'

export type ClientAppDataCapabilities = {
  provider: 'convex'
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
  requiresConvexClient: boolean
}

const DEFAULT_APP_DATA_CAPABILITIES: ClientAppDataCapabilities = {
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
  requiresConvexClient: true,
}

type CapabilitiesContextValue = {
  capabilities: CapabilityCheck
  appDataCapabilities: ClientAppDataCapabilities
  integrationProvider: 'none' | 'composio' | 'executor'
  isLoading: boolean
}

const CapabilitiesContext = createContext<CapabilitiesContextValue | null>(null)

/**
 * The deployment's capabilities, as the server rendered them for this page. They are deployment configuration, not
 * data that changes while the app runs, so there is nothing to refetch.
 */
export function CapabilitiesProvider({
  children,
  initialAppDataCapabilities,
  initialCapabilities,
  initialIntegrationProvider = 'none',
}: {
  children: React.ReactNode
  initialAppDataCapabilities: ClientAppDataCapabilities
  initialCapabilities: CapabilityCheck
  initialIntegrationProvider?: 'none' | 'composio' | 'executor'
}) {
  const capabilities = initialCapabilities
  const appDataCapabilities = initialAppDataCapabilities
  const isLoading = false

  const value = useMemo(
    () => ({ appDataCapabilities, capabilities, integrationProvider: initialIntegrationProvider ?? 'none', isLoading }),
    [appDataCapabilities, capabilities, initialIntegrationProvider, isLoading],
  )

  return (
    <CapabilitiesContext.Provider value={value}>
      {children}
    </CapabilitiesContext.Provider>
  )
}

export function useOverlayCapabilities(): CapabilitiesContextValue {
  return useContext(CapabilitiesContext) ?? {
    appDataCapabilities: DEFAULT_APP_DATA_CAPABILITIES,
    capabilities: DEFAULT_OVERLAY_CAPABILITIES,
    integrationProvider: 'none' as const,
    isLoading: true,
  }
}
