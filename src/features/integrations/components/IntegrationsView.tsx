'use client'

// Compatibility wrapper: canonical integration contracts/controllers live in
// @overlay/app-core, typed transport in @overlay/api-client, and reusable
// presentation in @overlay/modules-react.
import { useCallback, useEffect, useMemo, useState } from 'react'
import posthog from 'posthog-js'
import {
  DEFAULT_CONNECTOR_CATALOG,
  connectorFromIntegrationSummary,
  filterConnectorCatalog,
  getAvailableConnectorRows,
  getConnectedConnectorRows,
  integrationRegistryToConnectorCatalog,
  mergeConnectorCatalogEntries,
  type AppBootstrapResponse,
  type ConnectedIntegrationsResponse,
  type ConnectorCatalogItem,
  type IntegrationSearchResponse,
} from '@overlay/app-core'
import { AppScreenShell } from '@overlay/modules-react/shell'
import { ExtensionPageHeader, IntegrationsPanel } from '@overlay/modules-react/extensions'
import { IntegrationListSkeleton } from '@overlay/ui/feedback'
import { INTEGRATIONS_BC_CHANNEL, notifyIntegrationsChanged } from '@/shared/integrations/integrations-events'
import { setIntegrationLogoUrl } from '@/shared/integrations/integration-logo-cache'
import { IntegrationsDialog } from '@/features/integrations/components/IntegrationsDialog'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

const LIST_PAGE_SIZE = 8

type IntegrationsInitialData = {
  bootstrap?: AppBootstrapResponse | null
  connected?: ConnectedIntegrationsResponse | null
  catalog?: IntegrationSearchResponse | null
}

function buildInitialIntegrationState(initialData?: IntegrationsInitialData) {
  const connected = new Set(initialData?.connected?.connected || [])
  let catalogItems: ConnectorCatalogItem[] = []

  if (initialData?.bootstrap?.integrationRegistry) {
    catalogItems = mergeConnectorCatalogEntries(
      catalogItems,
      integrationRegistryToConnectorCatalog(initialData.bootstrap.integrationRegistry),
    )
  }

  const connectedItems = (Array.isArray(initialData?.connected?.items) ? initialData.connected.items : []).map((item) =>
    connectorFromIntegrationSummary({ ...item, isConnected: true }),
  )
  catalogItems = mergeConnectorCatalogEntries(catalogItems, connectedItems)

  const searchedItems = (Array.isArray(initialData?.catalog?.items) ? initialData.catalog.items : []).map((item) =>
    connectorFromIntegrationSummary(item),
  )
  catalogItems = mergeConnectorCatalogEntries(catalogItems, searchedItems)

  const logos: Record<string, string | null> = {}
  for (const item of catalogItems) {
    logos[item.slug] = item.logoUrl ?? null
    logos[item.providerKey] = item.logoUrl ?? null
  }

  return { connected, catalogItems, logos }
}

export default function IntegrationsView({
  userId: _userId,
  initialData,
  title = 'Integrations',
}: {
  userId: string
  initialData?: IntegrationsInitialData
  title?: string
}) {
  void _userId
  const hasInitialData = Boolean(initialData?.bootstrap || initialData?.connected || initialData?.catalog)
  const initialState = useMemo(() => buildInitialIntegrationState(initialData), [initialData])
  const [connected, setConnected] = useState<Set<string>>(() => initialState.connected)
  const [catalogItems, setCatalogItems] = useState<ConnectorCatalogItem[]>(() => initialState.catalogItems)
  const [logos, setLogos] = useState<Record<string, string | null>>(() => initialState.logos)
  const [isLoading, setIsLoading] = useState(!hasInitialData)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [connectedVisible, setConnectedVisible] = useState(LIST_PAGE_SIZE)
  const [availableVisible, setAvailableVisible] = useState(LIST_PAGE_SIZE)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const rememberLogos = useCallback((items: readonly ConnectorCatalogItem[]) => {
    setLogos((prev) => {
      const next = { ...prev }
      for (const item of items) {
        next[item.slug] = item.logoUrl ?? null
        next[item.providerKey] = item.logoUrl ?? null
        setIntegrationLogoUrl(item.slug, item.logoUrl ?? null)
        setIntegrationLogoUrl(item.providerKey, item.logoUrl ?? null)
      }
      return next
    })
  }, [])

  useEffect(() => {
    for (const item of initialState.catalogItems) {
      setIntegrationLogoUrl(item.slug, item.logoUrl ?? null)
      setIntegrationLogoUrl(item.providerKey, item.logoUrl ?? null)
    }
  }, [initialState.catalogItems])

  const loadRegistry = useCallback(async () => {
    try {
      const res = await overlayAppClient.bootstrap.getResponse()
      if (!res.ok) return
      const data = (await res.json()) as AppBootstrapResponse
      const items = integrationRegistryToConnectorCatalog(data.integrationRegistry ?? [])
      setCatalogItems((prev) => mergeConnectorCatalogEntries(prev, items))
      rememberLogos(items)
    } catch {
      // optional registry metadata
    }
  }, [rememberLogos])

  const loadConnected = useCallback(async () => {
    try {
      const data = await overlayAppClient.integrations.get<ConnectedIntegrationsResponse>()
      setConnected(new Set(data.connected || []))
      const items = (Array.isArray(data.items) ? data.items : []).map((item) =>
        connectorFromIntegrationSummary({ ...item, isConnected: true }),
      )
      if (items.length > 0) {
        setCatalogItems((prev) => mergeConnectorCatalogEntries(prev, items))
        rememberLogos(items)
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [rememberLogos])

  const loadCatalog = useCallback(async () => {
    try {
      const data = await overlayAppClient.integrations.get<IntegrationSearchResponse>({ action: 'search', limit: 100 })
      const items = (Array.isArray(data.items) ? data.items : []).map((item) => connectorFromIntegrationSummary(item))
      setCatalogItems((prev) => mergeConnectorCatalogEntries(prev, items))
      rememberLogos(items)
    } catch {
      // optional
    }
  }, [rememberLogos])

  useEffect(() => {
    void loadRegistry()
    void loadConnected()
    void loadCatalog()
  }, [loadCatalog, loadConnected, loadRegistry])

  useEffect(() => {
    const onFocus = () => {
      void loadConnected()
      void loadCatalog()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadConnected, loadCatalog])

  useEffect(() => {
    const onIntegrationsChanged = () => {
      void loadConnected()
      void loadCatalog()
    }
    window.addEventListener('overlay:integrations-changed', onIntegrationsChanged)
    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(INTEGRATIONS_BC_CHANNEL)
      bc.onmessage = onIntegrationsChanged
    } catch {
      /* ignore */
    }
    return () => {
      window.removeEventListener('overlay:integrations-changed', onIntegrationsChanged)
      bc?.close()
    }
  }, [loadConnected, loadCatalog])

  async function handleConnect(integration: ConnectorCatalogItem) {
    if (connecting) return
    if (connected.has(integration.providerKey) && integration.capabilities?.supportsDisconnect === false) return
    setConnectError(null)
    setConnecting(integration.providerKey)

    let oauthTab: Window | null = null
    if (!connected.has(integration.providerKey)) {
      oauthTab = window.open('about:blank', '_blank')
    }

    try {
      if (connected.has(integration.providerKey)) {
        const res = await overlayAppClient.integrations.disconnectResponse(integration.providerKey)
        if (res.ok) {
          setConnected((prev) => {
            const next = new Set(prev)
            next.delete(integration.providerKey)
            return next
          })
          notifyIntegrationsChanged()
          posthog.capture('integration_disconnected', { integration: integration.providerKey, integration_name: integration.name })
        } else {
          const data = await res.json().catch(() => ({}))
          setConnectError(data.error || 'Failed to disconnect')
        }
      } else {
        const res = await overlayAppClient.integrations.connectResponse({ action: 'connect', providerKey: integration.providerKey })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          oauthTab?.close()
          setConnectError(data.error || 'Failed to connect')
        } else if (data.redirectUrl) {
          if (oauthTab) oauthTab.location.href = data.redirectUrl
          else window.open(data.redirectUrl, '_blank')
          posthog.capture('integration_connect_initiated', { integration: integration.providerKey, integration_name: integration.name })
        } else {
          oauthTab?.close()
          setConnectError('No connection setup URL was returned')
        }
      }
    } catch {
      oauthTab?.close()
      setConnectError('Connection failed')
    } finally {
      setConnecting(null)
    }
  }

  const dialogConnect = useCallback(async (slug: string) => {
    const oauthTab = window.open('about:blank', '_blank')
    try {
      const res = await overlayAppClient.integrations.connectResponse({ action: 'connect', providerKey: slug })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        oauthTab?.close()
        throw new Error(data.error || 'Failed to initiate connection')
      }
      if (data.redirectUrl) {
        if (oauthTab) oauthTab.location.href = data.redirectUrl
        else window.open(data.redirectUrl, '_blank')
        posthog.capture('integration_connect_initiated', { integration: slug })
      } else if (data.connectionId) {
        oauthTab?.close()
        setConnected((prev) => new Set([...prev, slug]))
        notifyIntegrationsChanged()
        posthog.capture('integration_connect_initiated', { integration: slug })
      } else {
        oauthTab?.close()
        throw new Error('No connection setup URL returned')
      }
    } catch (err) {
      oauthTab?.close()
      throw err
    }
  }, [])

  const dialogDisconnect = useCallback(async (slug: string) => {
    const res = await overlayAppClient.integrations.disconnectResponse(slug)
    if (!res.ok) throw new Error('Failed to disconnect')
    setConnected((prev) => {
      const next = new Set(prev)
      next.delete(slug)
      return next
    })
    notifyIntegrationsChanged()
    posthog.capture('integration_disconnected', { integration: slug })
  }, [])

  const connectedRows = useMemo(() => getConnectedConnectorRows(connected, catalogItems), [connected, catalogItems])
  const availableList = useMemo(() => getAvailableConnectorRows(connected, catalogItems, DEFAULT_CONNECTOR_CATALOG), [connected, catalogItems])

  useEffect(() => {
    setConnectedVisible(LIST_PAGE_SIZE)
  }, [connected.size])

  useEffect(() => {
    setAvailableVisible(LIST_PAGE_SIZE)
  }, [availableList.length])

  const filteredConnectedRows = useMemo(
    () => filterConnectorCatalog(connectedRows, searchQuery),
    [connectedRows, searchQuery],
  )
  const filteredAvailableList = useMemo(
    () => filterConnectorCatalog(availableList, searchQuery),
    [availableList, searchQuery],
  )

  return (
    <AppScreenShell
      header={
        <ExtensionPageHeader
          title={title}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          searchPlaceholder="Search integrations…"
          searchTitle="Search integrations"
          onSearchOpenChange={setSearchOpen}
          onSearchQueryChange={setSearchQuery}
        />
      }
    >
      <IntegrationsPanel
        loading={isLoading}
        loadingFallback={<IntegrationListSkeleton rows={10} />}
        connectedRows={filteredConnectedRows}
        availableRows={filteredAvailableList}
        connectedVisible={connectedVisible}
        availableVisible={availableVisible}
        connectingSlug={connecting}
        error={connectError}
        logoUrls={logos}
        onClearError={() => setConnectError(null)}
        onConnectToggle={(integration) => void handleConnect(integration)}
        onShowMoreConnected={() => setConnectedVisible((n) => n + LIST_PAGE_SIZE)}
        onShowMoreAvailable={() => setAvailableVisible((n) => n + LIST_PAGE_SIZE)}
        onOpenCatalog={() => setIsDialogOpen(true)}
      />

      <IntegrationsDialog
        connectedSlugs={connected}
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onConnect={dialogConnect}
        onDisconnect={dialogDisconnect}
      />
    </AppScreenShell>
  )
}
