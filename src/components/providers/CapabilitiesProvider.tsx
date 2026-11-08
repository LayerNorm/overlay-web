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

type CapabilitiesContextValue = {
  capabilities: CapabilityCheck
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
  initialCapabilities,
  initialIntegrationProvider = 'none',
}: {
  children: React.ReactNode
  initialCapabilities: CapabilityCheck
  initialIntegrationProvider?: 'none' | 'composio' | 'executor'
}) {
  const capabilities = initialCapabilities
  const isLoading = false

  const value = useMemo(
    () => ({ capabilities, integrationProvider: initialIntegrationProvider ?? 'none', isLoading }),
    [capabilities, initialIntegrationProvider, isLoading],
  )

  return (
    <CapabilitiesContext.Provider value={value}>
      {children}
    </CapabilitiesContext.Provider>
  )
}

export function useOverlayCapabilities(): CapabilitiesContextValue {
  return useContext(CapabilitiesContext) ?? {
    capabilities: DEFAULT_OVERLAY_CAPABILITIES,
    integrationProvider: 'none' as const,
    isLoading: true,
  }
}
