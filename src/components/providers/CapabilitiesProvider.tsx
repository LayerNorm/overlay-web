'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  DEFAULT_OVERLAY_CAPABILITIES,
  type CapabilityCheck,
} from '@overlay/app-core'

export type ClientAppDataCapabilities = {
  provider: 'convex' | 'postgres'
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

const DEFAULT_APP_DATA_CAPABILITIES: ClientAppDataCapabilities = {
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

type CapabilitiesContextValue = {
  capabilities: CapabilityCheck
  appDataCapabilities: ClientAppDataCapabilities
  integrationProvider: 'none' | 'composio' | 'executor'
  isLoading: boolean
}

const CapabilitiesContext = createContext<CapabilitiesContextValue | null>(null)

function normalizeCapabilities(value: unknown): CapabilityCheck | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<CapabilityCheck>
  const keys = Object.keys(DEFAULT_OVERLAY_CAPABILITIES) as Array<keyof CapabilityCheck>
  if (!keys.every((key) => candidate[key] === undefined || typeof candidate[key] === 'boolean')) {
    return null
  }
  return { ...DEFAULT_OVERLAY_CAPABILITIES, ...candidate }
}

function normalizeAppDataCapabilities(value: unknown): ClientAppDataCapabilities | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ClientAppDataCapabilities>
  if (candidate.provider !== 'convex' && candidate.provider !== 'postgres') return null
  for (const key of [
    'supportsRealtime',
    'supportsStreamResume',
    'supportsChatPersistence',
    'supportsFileMetadata',
    'supportsFileUploads',
    'supportsNotes',
    'supportsProjects',
    'supportsIntegrations',
    'supportsSkills',
    'supportsMcpServers',
    'supportsSettings',
    'supportsOnboarding',
    'supportsUsageAccounting',
    'supportsBillingRecords',
    'supportsVectorSearch',
    'supportsAutomations',
    'supportsWebhooks',
    'supportsApiKeys',
    'supportsAccountDeletion',
    'supportsBackgroundMaintenance',
    'supportsManagedScheduler',
    'supportsPersistentIdempotency',
    'supportsServiceAuthReplayStore',
    'requiresConvexClient',
  ] as const) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'boolean') return null
  }
  return { ...DEFAULT_APP_DATA_CAPABILITIES, ...candidate }
}

export function CapabilitiesProvider({
  children,
  initialAppDataCapabilities,
  initialCapabilities,
  initialIntegrationProvider = 'none',
}: {
  children: React.ReactNode
  initialAppDataCapabilities?: ClientAppDataCapabilities
  initialCapabilities?: CapabilityCheck
  initialIntegrationProvider?: 'none' | 'composio' | 'executor'
}) {
  const [capabilities, setCapabilities] = useState<CapabilityCheck>(
    initialCapabilities ?? DEFAULT_OVERLAY_CAPABILITIES,
  )
  const [appDataCapabilities, setAppDataCapabilities] = useState<ClientAppDataCapabilities>(
    initialAppDataCapabilities ?? DEFAULT_APP_DATA_CAPABILITIES,
  )
  const [isLoading, setIsLoading] = useState(!initialCapabilities || !initialAppDataCapabilities)

  useEffect(() => {
    if (initialCapabilities && initialAppDataCapabilities) return
    let active = true
    void fetch('/api/v1/capabilities', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null
        return await response.json()
      })
      .then((payload) => {
        const next = normalizeCapabilities(payload?.capabilities)
        if (active && next) setCapabilities(next)
        const nextAppData = normalizeAppDataCapabilities(payload?.appDataCapabilities)
        if (active && nextAppData) setAppDataCapabilities(nextAppData)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [initialAppDataCapabilities, initialCapabilities])

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
