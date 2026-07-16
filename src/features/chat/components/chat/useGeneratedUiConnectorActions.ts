'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ConnectedIntegrationsResponse } from '@overlay/app-core'
import type { GeneratedEmailDraftData } from '@overlay/chat-core/generated-ui'
import type { GeneratedUiConnectorActions } from '@overlay/chat-react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  INTEGRATIONS_BC_CHANNEL,
  notifyIntegrationsChanged,
} from '@/shared/integrations/integrations-events'
import {
  getIntegrationLogoUrl,
  resolveSlugFromName,
  setIntegrationLogoUrl,
  warmIntegrationLogoCache,
} from '@/shared/integrations/integration-logo-cache'

function formatCsv(value?: string[]): string {
  return value?.join(', ') ?? ''
}

function gmailComposeUrl(data: GeneratedEmailDraftData): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(formatCsv(data.to))}&cc=${encodeURIComponent(formatCsv(data.cc))}&bcc=${encodeURIComponent(formatCsv(data.bcc))}&su=${encodeURIComponent(data.subject)}&body=${encodeURIComponent(data.body)}`
}

function resolveConnectorSlug(serviceName: string, slug?: string): string | null {
  return slug?.trim() || resolveSlugFromName(serviceName)
}

export function useGeneratedUiConnectorActions(): GeneratedUiConnectorActions {
  const [connected, setConnected] = useState<Set<string>>(() => new Set())

  const loadConnected = useCallback(async () => {
    try {
      const data = await overlayAppClient.integrations.get<ConnectedIntegrationsResponse>()
      setConnected(new Set(data.connected ?? []))
      for (const item of data.items ?? data.data ?? []) {
        if (item.slug) setIntegrationLogoUrl(item.slug, item.logoUrl ?? null)
      }
    } catch {
      setConnected(new Set())
    }
  }, [])

  useEffect(() => {
    void warmIntegrationLogoCache()
    const initialLoad = window.setTimeout(() => void loadConnected(), 0)

    const onChanged = () => void loadConnected()
    window.addEventListener('overlay:integrations-changed', onChanged)
    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(INTEGRATIONS_BC_CHANNEL)
      bc.onmessage = onChanged
    } catch {
      bc = null
    }
    return () => {
      window.clearTimeout(initialLoad)
      window.removeEventListener('overlay:integrations-changed', onChanged)
      bc?.close()
    }
  }, [loadConnected])

  const getLogoUrl = useCallback((serviceName: string, slug?: string) => {
    const resolved = resolveConnectorSlug(serviceName, slug)
    return resolved ? getIntegrationLogoUrl(resolved) : null
  }, [])

  const isConnected = useCallback((serviceName: string, slug?: string) => {
    const resolved = resolveConnectorSlug(serviceName, slug)
    return Boolean(resolved && connected.has(resolved))
  }, [connected])

  const connect = useCallback(async (serviceName: string, slug?: string) => {
    const resolved = resolveConnectorSlug(serviceName, slug)
    if (!resolved) return
    const oauthTab = window.open('about:blank', '_blank')
    try {
      const res = await overlayAppClient.integrations.connectResponse({ action: 'connect', providerKey: resolved })
      const data = (await res.json().catch(() => ({}))) as {
        redirectUrl?: string | null
        connectionId?: string | null
        error?: string
      }
      if (!res.ok) {
        oauthTab?.close()
        return
      }
      if (data.redirectUrl) {
        if (oauthTab) oauthTab.location.href = data.redirectUrl
        else window.open(data.redirectUrl, '_blank', 'noopener,noreferrer')
        return
      }
      if (data.connectionId) {
        oauthTab?.close()
        setConnected((prev) => new Set([...prev, resolved]))
        notifyIntegrationsChanged()
        return
      }
      oauthTab?.close()
    } catch {
      oauthTab?.close()
    }
  }, [])

  const openExternalUrl = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  const openEmailDraft = useCallback((data: GeneratedEmailDraftData) => {
    window.open(gmailComposeUrl(data), '_blank', 'noopener,noreferrer')
  }, [])

  return useMemo(
    () => ({
      getLogoUrl,
      isConnected,
      connect,
      openExternalUrl,
      openEmailDraft,
    }),
    [connect, getLogoUrl, isConnected, openEmailDraft, openExternalUrl],
  )
}
