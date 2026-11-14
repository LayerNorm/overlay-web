'use client'

// Compatibility wrapper: canonical integration contracts/controllers live in
// @overlay/app-core, typed transport in @overlay/api-client, and reusable
// presentation in @overlay/modules-react.
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  CONNECTOR_CATEGORIES,
  connectorFromIntegrationSummary,
  getAvailableConnectorRows,
  getConnectedConnectorRows,
  integrationRegistryToConnectorCatalog,
  mergeConnectorCatalogEntries,
  resolveOverlayAppShellConfig,
  type ConnectedIntegrationsResponse,
  type ConnectorCatalogItem,
  type IntegrationSearchResponse,
} from '@overlay/app-core'
import { groupExtensionCatalog } from '@overlay/app-core/extensions'
import { ConnectorDetailsDialog, ExtensionCatalogPage, type ExtensionCatalogEntry } from '@overlay/modules-react/extensions'
import { toast } from '@overlay/ui/primitives'
import { Plug, Server, Settings, Unplug } from 'lucide-react'
import { INTEGRATIONS_BC_CHANNEL, notifyIntegrationsChanged } from '@/shared/integrations/integrations-events'
import { setIntegrationLogoUrl } from '@/shared/integrations/integration-logo-cache'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { safeHttpUrl } from '@/shared/security/safe-url'
import { useWorkspaceChanged } from '@/hooks/use-workspace-changed'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { ExtensionsScreen } from '@/components/layout/extensions/ExtensionsScreen'
import { useExtensionsRoute } from '@/hooks/use-extensions-route'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import overlayAppConfig from '@/overlay.config'

const SEARCH_DEBOUNCE_MS = 300

type IntegrationsInitialData = {
  connected?: ConnectedIntegrationsResponse | null
  catalog?: IntegrationSearchResponse | null
}

/** The deployment's configured integrations: static app config, filtered by what this deployment can do. */
function useIntegrationRegistry() {
  const { capabilities } = useOverlayCapabilities()
  return useMemo(
    () => integrationRegistryToConnectorCatalog([...resolveOverlayAppShellConfig(overlayAppConfig, { capabilities }).integrations]),
    [capabilities],
  )
}

function buildInitialIntegrationState(registry: ConnectorCatalogItem[], initialData?: IntegrationsInitialData) {
  const connected = new Set(initialData?.connected?.connected || [])
  let catalogItems: ConnectorCatalogItem[] = registry

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
}: {
  userId: string
  initialData?: IntegrationsInitialData
}) {
  void _userId
  const hasInitialData = Boolean(initialData?.connected || initialData?.catalog)
  const registry = useIntegrationRegistry()
  const initialState = useMemo(() => buildInitialIntegrationState(registry, initialData), [registry, initialData])
  const [connected, setConnected] = useState<Set<string>>(() => initialState.connected)
  const [catalogItems, setCatalogItems] = useState<ConnectorCatalogItem[]>(() => initialState.catalogItems)
  const [logos, setLogos] = useState<Record<string, string | null>>(() => initialState.logos)
  const [isLoading, setIsLoading] = useState(!hasInitialData)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [details, setDetails] = useState<ConnectorCatalogItem | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const route = useExtensionsRoute()
  const { capabilities } = useOverlayCapabilities()
  // In Workspace, the same connectors link to the workspace's own accounts (shared by every member), not the person's.
  const workspaceScope = usePanelScope() === 'workspace'
  const accountScope = workspaceScope ? ('workspace' as const) : undefined

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

  const loadConnected = useCallback(async () => {
    try {
      const data = await overlayAppClient.integrations.get<ConnectedIntegrationsResponse>(workspaceScope ? { view: 'workspace' } : undefined)
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
  }, [rememberLogos, workspaceScope])

  const loadCatalog = useCallback(async () => {
    try {
      const data = await overlayAppClient.integrations.get<IntegrationSearchResponse>({ action: 'search', limit: 100, ...(workspaceScope ? { view: 'workspace' as const } : {}) })
      const items = (Array.isArray(data.items) ? data.items : []).map((item) => connectorFromIntegrationSummary(item))
      setCatalogItems((prev) => mergeConnectorCatalogEntries(prev, items))
      rememberLogos(items)
    } catch {
      // optional
    }
  }, [rememberLogos, workspaceScope])

  useEffect(() => {
    // Skip the initial mount fetch when server-rendered data is already
    // present.  The three BFF requests would duplicate what the server
    // already fetched.  We still listen for mutation events below.
    if (hasInitialData) return
    void loadConnected()
    void loadCatalog()
  }, [hasInitialData, loadCatalog, loadConnected])

  useWorkspaceChanged(useCallback(() => {
    loadConnected()
    loadCatalog()
    }, [loadConnected, loadCatalog]),
  )

  const lastFocusFetchAtRef = useRef(Date.now())
  const onFocus = useEffectEvent(() => {
    // Only refetch on focus if at least 60 seconds have passed since
    // the last fetch.  Prevents redundant requests when rapidly switching tabs.
    if (Date.now() - lastFocusFetchAtRef.current < 60_000) return
    lastFocusFetchAtRef.current = Date.now()
    void loadConnected()
    void loadCatalog()
  })

  useEffect(() => {
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

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

  // Search reaches the provider's whole catalog, not only the first page loaded above.
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const data = await overlayAppClient.integrations.get<IntegrationSearchResponse>({ action: 'search', q, limit: 24, ...(workspaceScope ? { view: 'workspace' as const } : {}) })
        if (cancelled) return
        const items = (Array.isArray(data.items) ? data.items : []).map((item) => connectorFromIntegrationSummary(item))
        setCatalogItems((prev) => mergeConnectorCatalogEntries(prev, items))
        rememberLogos(items)
      } catch {
        // The loaded catalog still filters locally.
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchQuery, workspaceScope, rememberLogos])

  const isConnected = useCallback((item: ConnectorCatalogItem) => connected.has(item.providerKey) || connected.has(item.slug), [connected])

  async function connect(integration: ConnectorCatalogItem) {
    if (connecting) return
    setConnecting(integration.providerKey)
    // Opened before any await so the browser treats the provider page as user-initiated, not a blocked popup.
    const oauthTab = window.open('about:blank', '_blank')
    try {
      const res = await overlayAppClient.integrations.connectResponse({ action: 'connect', providerKey: integration.providerKey, ...(accountScope ? { scope: accountScope } : {}) })
      const data = await res.json().catch(() => ({}))
      const redirectUrl = res.ok ? safeHttpUrl(data.redirectUrl) : null
      if (redirectUrl) {
        if (oauthTab) oauthTab.location.href = redirectUrl
        else window.open(redirectUrl, '_blank', 'noopener,noreferrer')
        return
      }
      oauthTab?.close()
      if (!res.ok) toast.error(data.error || `Could not connect ${integration.name}`)
      else if (data.connectionId) {
        setConnected((prev) => new Set([...prev, integration.providerKey]))
        notifyIntegrationsChanged()
        toast.success(`${integration.name} connected`)
      } else toast.error('No connection setup URL was returned')
    } catch {
      oauthTab?.close()
      toast.error(`Could not connect ${integration.name}`)
    } finally {
      setConnecting(null)
    }
  }

  async function disconnect(integration: ConnectorCatalogItem) {
    if (connecting || integration.capabilities?.supportsDisconnect === false) return
    setConnecting(integration.providerKey)
    try {
      const res = await overlayAppClient.integrations.disconnectResponse(integration.providerKey, undefined, accountScope)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || `Could not disconnect ${integration.name}`)
        return
      }
      setConnected((prev) => {
        const next = new Set(prev)
        next.delete(integration.providerKey)
        next.delete(integration.slug)
        return next
      })
      notifyIntegrationsChanged()
      toast(`${integration.name} disconnected`)
    } catch {
      toast.error(`Could not disconnect ${integration.name}`)
    } finally {
      setConnecting(null)
    }
  }

  const connectedRows = useMemo(() => getConnectedConnectorRows(connected, catalogItems), [connected, catalogItems])
  const availableRows = useMemo(() => getAvailableConnectorRows(connected, catalogItems), [connected, catalogItems])

  const toEntry = (item: ConnectorCatalogItem): ExtensionCatalogEntry => {
    const linked = isConnected(item)
    const managed = item.capabilities?.supportsDisconnect === false
    return {
      id: item.providerKey,
      name: item.name,
      description: item.description,
      logo: { kind: 'image', src: logos[item.providerKey] ?? item.logoUrl },
      busy: connecting === item.providerKey,
      onOpen: () => setDetails(item),
      onAdd: linked ? undefined : () => void connect(item),
      menu: linked ? [
        { label: 'Settings', icon: Settings, onSelect: () => setDetails(item) },
        { label: managed ? 'Managed externally' : 'Disconnect', icon: Unplug, disabled: managed, onSelect: () => void disconnect(item) },
      ] : undefined,
    }
  }

  const browse = groupExtensionCatalog([...connectedRows, ...availableRows], CONNECTOR_CATEGORIES, (item) => item.slug)
    .map((section) => ({ ...section, items: section.items.map(toEntry) }))
  const yours = [{ id: 'connected', title: 'Connected', items: connectedRows.map(toEntry) }]
  const openSection = route.category ? browse.find((section) => section.id === route.category) : undefined
  const detailsConnected = details ? isConnected(details) : false

  return (
    <ExtensionsScreen title="Connectors" sectionTitle={openSection?.title} overviewHref={route.overviewHref}>
      <ExtensionCatalogPage
        title="Connectors"
        subtitle="Let Overlay and your agents work across the apps you use."
        noun="connectors"
        icon={Plug}
        yoursLabel={workspaceScope ? 'Workspace' : 'Yours'}
        loading={isLoading}
        browse={browse}
        yours={yours}
        yoursEmpty={{ title: 'No connectors yet', body: workspaceScope ? 'Connectors the workspace connects will appear here.' : 'Connectors you connect will appear here.' }}
        addOptions={capabilities.mcpServers ? [{ id: 'mcp', label: 'Custom MCP server', icon: Server, onSelect: () => route.openView('mcps', { add: true }) }] : undefined}
        category={route.category}
        onCategoryChange={route.openCategory}
        onQueryChange={(query) => {
          setSearchQuery(query)
          setSearching(Boolean(query.trim()))
        }}
        searching={searching}
        noResults={capabilities.mcpServers
          ? { body: 'Check the spelling, or connect any tool through an MCP server.', action: { label: 'Browse MCPs', onSelect: () => route.openView('mcps') } }
          : { body: 'Check the spelling and try again.' }}
      />
      {details ? (
        <ConnectorDetailsDialog
          connector={details}
          logoUrl={logos[details.providerKey] ?? details.logoUrl}
          connected={detailsConnected}
          busy={connecting === details.providerKey}
          accountLabel={workspaceScope ? 'The workspace’s account, shared with members' : 'Your account'}
          onClose={() => setDetails(null)}
          onConnect={() => void connect(details)}
          onDisconnect={() => void disconnect(details)}
        />
      ) : null}
    </ExtensionsScreen>
  )
}
