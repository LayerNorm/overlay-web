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
  supportsSettings: boolean
  supportsOnboarding: boolean
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
  supportsSettings: true,
  supportsOnboarding: true,
  supportsBackgroundMaintenance: true,
  supportsManagedScheduler: true,
  supportsPersistentIdempotency: true,
  supportsServiceAuthReplayStore: true,
  requiresConvexClient: true,
}

type CapabilitiesContextValue = {
  capabilities: CapabilityCheck
  appDataCapabilities: ClientAppDataCapabilities
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
    'supportsSettings',
    'supportsOnboarding',
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
}: {
  children: React.ReactNode
  initialAppDataCapabilities?: ClientAppDataCapabilities
  initialCapabilities?: CapabilityCheck
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
    () => ({ appDataCapabilities, capabilities, isLoading }),
    [appDataCapabilities, capabilities, isLoading],
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
    isLoading: true,
  }
}
