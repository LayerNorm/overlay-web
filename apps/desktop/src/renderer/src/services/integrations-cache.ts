import {
  connectorFromIntegrationSummary,
  mergeConnectorCatalogEntries,
  type ConnectedIntegrationsResponse,
  type ConnectorCatalogItem,
  type IntegrationSearchResponse
} from '@overlay/app-core'
import { desktopAppJson } from './app-api-client'

export interface DesktopIntegrationsSnapshot {
  connected: ReadonlySet<string>
  catalog: readonly ConnectorCatalogItem[]
  loadedAt: number
}

type SnapshotListener = (snapshot: DesktopIntegrationsSnapshot) => void

let cachedSnapshot: DesktopIntegrationsSnapshot | null = null
let pendingLoad: Promise<DesktopIntegrationsSnapshot> | null = null
const listeners = new Set<SnapshotListener>()

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

function sortCatalog(items: readonly ConnectorCatalogItem[]): ConnectorCatalogItem[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

function publish(snapshot: DesktopIntegrationsSnapshot): DesktopIntegrationsSnapshot {
  cachedSnapshot = snapshot
  for (const listener of listeners) listener(snapshot)
  return snapshot
}

export function getCachedDesktopIntegrations(): DesktopIntegrationsSnapshot | null {
  return cachedSnapshot
}

export function subscribeDesktopIntegrations(listener: SnapshotListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function fetchDesktopIntegrations({
  force = false
}: {
  force?: boolean
} = {}): Promise<DesktopIntegrationsSnapshot> {
  if (!force && cachedSnapshot) return cachedSnapshot
  if (pendingLoad) return pendingLoad

  pendingLoad = (async () => {
    const [connectedResult, catalogResult] = await Promise.allSettled([
      desktopAppJson<ConnectedIntegrationsResponse>('/api/v1/integrations'),
      desktopAppJson<IntegrationSearchResponse>('/api/v1/integrations?action=search&limit=100')
    ])

    if (connectedResult.status === 'rejected' && catalogResult.status === 'rejected') {
      throw connectedResult.reason
    }

    const connectedResponse = connectedResult.status === 'fulfilled' ? connectedResult.value : null
    const catalogResponse = catalogResult.status === 'fulfilled' ? catalogResult.value : null
    const connectedSource =
      connectedResponse?.connected ?? Array.from(cachedSnapshot?.connected ?? [])
    const connected = new Set(connectedSource.map(normalizeKey))

    const connectedItems = (connectedResponse?.items ?? []).map((item) =>
      connectorFromIntegrationSummary({ ...item, isConnected: true })
    )
    const catalogItems = (catalogResponse?.items ?? catalogResponse?.data ?? []).map((item) =>
      connectorFromIntegrationSummary(item)
    )
    const previousCatalog = cachedSnapshot?.catalog ?? []

    return publish({
      connected,
      catalog: sortCatalog(
        mergeConnectorCatalogEntries(
          mergeConnectorCatalogEntries(previousCatalog, connectedItems),
          catalogItems
        )
      ),
      loadedAt: Date.now()
    })
  })().finally(() => {
    pendingLoad = null
  })

  return pendingLoad
}

export function prehydrateDesktopIntegrations(): void {
  void fetchDesktopIntegrations().catch((error) => {
    console.warn('[integrations-cache] Failed to prehydrate integrations:', error)
  })
}
