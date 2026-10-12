'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_OVERLAY_CAPABILITIES, type CapabilityCheck } from '@overlay/app-core'

type AccountMessage = { type: 'success' | 'error'; text: string }

/**
 * Account page state. An account is never free or paid (plans belong to workspaces), so this only tracks whether
 * Overlay billing is on for the deployment, plus the page's message and in-flight action.
 */
export function useAccountBillingState() {
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<AccountMessage | null>(null)
  const [capabilities, setCapabilities] = useState<CapabilityCheck>(DEFAULT_OVERLAY_CAPABILITIES)
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false)

  // Client-side data load on mount — no server data layer in this app.
  // react-doctor-disable-next-line react-doctor/no-fetch-in-effect
  useEffect(() => {
    let active = true
    void fetch('/api/v1/capabilities', { cache: 'no-store' })
      .then(async (response) => (response.ok ? await response.json() : null))
      .then((payload) => {
        const next = payload?.capabilities
        if (!active || !next || typeof next !== 'object') return
        setCapabilities({ ...DEFAULT_OVERLAY_CAPABILITIES, ...(next as Partial<CapabilityCheck>) })
      })
      .catch(() => {})
      .finally(() => {
        if (active) setCapabilitiesLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  return {
    actionLoading,
    billingEnabled: capabilities.billing,
    capabilitiesLoaded,
    loading: false,
    message,
    setActionLoading,
    setMessage,
  }
}
