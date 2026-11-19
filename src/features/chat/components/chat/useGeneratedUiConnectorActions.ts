'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectedIntegrationsResponse } from '@overlay/app-core'
import type { GeneratedEmailDraftData } from '@overlay/chat-core/generated-ui'
import type { GeneratedUiConnectorActions } from '@overlay/chat-react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { safeHttpUrl } from '@/shared/security/safe-url'
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

// After sign-in opens in another tab, re-check until the app shows up, so the
// card flips to Connected even if this tab never regains focus.
const PENDING_POLL_INTERVAL_MS = 3_000
const PENDING_POLL_TIMEOUT_MS = 120_000

function composioLogoUrl(slug: string): string {
  return `https://logos.composio.dev/api/${encodeURIComponent(slug)}`
}

function resolveConnectorSlug(serviceName: string, slug?: string): string | null {
  return slug?.trim() || resolveSlugFromName(serviceName)
}

export function useGeneratedUiConnectorActions({ enabled = true }: { enabled?: boolean } = {}): GeneratedUiConnectorActions {
  const [connected, setConnected] = useState<Set<string>>(() => new Set())
  const pendingPoll = useRef<number | null>(null)

  const loadConnected = useCallback(async (): Promise<Set<string>> => {
    try {
      const data = await overlayAppClient.integrations.get<ConnectedIntegrationsResponse>()
      const next = new Set(data.connected ?? [])
      setConnected(next)
      for (const item of data.items ?? data.data ?? []) {
        if (item.slug) setIntegrationLogoUrl(item.slug, item.logoUrl ?? null)
      }
      return next
    } catch {
      setConnected(new Set())
      return new Set()
    }
  }, [])

  const stopPendingPoll = useCallback(() => {
    if (pendingPoll.current !== null) window.clearInterval(pendingPoll.current)
    pendingPoll.current = null
  }, [])

  const watchPendingConnection = useCallback((slug: string) => {
    stopPendingPoll()
    const deadline = Date.now() + PENDING_POLL_TIMEOUT_MS
    pendingPoll.current = window.setInterval(() => {
      if (Date.now() > deadline) return stopPendingPoll()
      void loadConnected().then((next) => {
        if (!next.has(slug)) return
        stopPendingPoll()
        notifyIntegrationsChanged()
      })
    }, PENDING_POLL_INTERVAL_MS)
  }, [loadConnected, stopPendingPoll])

  useEffect(() => stopPendingPoll, [stopPendingPoll])

  useEffect(() => {
    if (!enabled) return
    void warmIntegrationLogoCache()
    const initialLoad = window.setTimeout(() => void loadConnected(), 0)

    const onChanged = () => void loadConnected()
    window.addEventListener('overlay:integrations-changed', onChanged)
    // OAuth finishes in another tab; refresh connected state when the user returns.
    window.addEventListener('focus', onChanged)
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
      window.removeEventListener('focus', onChanged)
      bc?.close()
    }
  }, [enabled, loadConnected])

  const getLogoUrl = useCallback((serviceName: string, slug?: string) => {
    const resolved = resolveConnectorSlug(serviceName, slug)
    if (!resolved) return null
    // The catalog logo cache warms in the background and doesn't re-render
    // cards, so fall back to Composio's stable logo URL for the slug.
    return getIntegrationLogoUrl(resolved) ?? composioLogoUrl(resolved)
  }, [])

  const isConnected = useCallback((serviceName: string, slug?: string) => {
    const resolved = resolveConnectorSlug(serviceName, slug)
    return Boolean(resolved && connected.has(resolved))
  }, [connected])

  const canConnect = useCallback((serviceName: string, slug?: string) => (
    enabled && Boolean(resolveConnectorSlug(serviceName, slug))
  ), [enabled])

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
      const redirectUrl = safeHttpUrl(data.redirectUrl)
      if (redirectUrl) {
        if (oauthTab) oauthTab.location.href = redirectUrl
        else window.open(redirectUrl, '_blank', 'noopener,noreferrer')
        watchPendingConnection(resolved)
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
  }, [watchPendingConnection])

  const openExternalUrl = useCallback((url: string) => {
    // Model-authored URL: normalizeGeneratedUiData already drops non-http(s),
    // this is the second gate so the sink is never reachable with javascript:.
    const safe = safeHttpUrl(url)
    if (!safe) return
    window.open(safe, '_blank', 'noopener,noreferrer')
  }, [])

  const openEmailDraft = useCallback((data: GeneratedEmailDraftData) => {
    window.open(gmailComposeUrl(data), '_blank', 'noopener,noreferrer')
  }, [])

  return useMemo(
    () => ({
      getLogoUrl,
      isConnected,
      canConnect,
      connect,
      openExternalUrl,
      openEmailDraft,
    }),
    [canConnect, connect, getLogoUrl, isConnected, openEmailDraft, openExternalUrl],
  )
}
