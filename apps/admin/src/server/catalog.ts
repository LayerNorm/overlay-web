import 'server-only'

import {
  normalizeIntegrationProviderKey,
  resolveOverlayAppShellConfig,
} from '@overlay/app-core'
import { INTERNAL_API_TOOL_DEFINITIONS } from '@overlay/tools-core'

import type { AdminCatalogResource, AdminCatalogResourceType } from '../shared/admin-types'
import {
  AVAILABLE_MODELS,
  IMAGE_MODELS,
  VIDEO_MODELS,
} from '../shared/ai/gateway/model-data'
import { composioApiKey } from './env'

type ComposioToolkitRecord = {
  description?: string
  meta?: { description?: string }
  name?: string
  slug?: string
}

/**
 * Live connector catalog (Composio toolkits), best effort. Mirrors the web
 * route's `.catch(() => [])` degradation: when COMPOSIO_API_KEY is unset or the
 * call fails, the static registry still lists every grantable connector.
 */
async function listProviderCatalog(): Promise<Array<{ description?: string; name: string; providerKey: string }>> {
  const apiKey = composioApiKey()
  if (!apiKey) return []
  const url = new URL('https://backend.composio.dev/api/v1/toolkits')
  url.searchParams.set('limit', '100')
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'x-api-key': apiKey },
  })
  if (!response.ok) return []
  const data = (await response.json()) as { items?: ComposioToolkitRecord[] } | ComposioToolkitRecord[]
  const rows = Array.isArray(data) ? data : data.items ?? []
  return rows
    .filter((row): row is ComposioToolkitRecord & { slug: string } => typeof row.slug === 'string')
    .map((row) => ({
      description: row.meta?.description ?? row.description,
      name: row.name ?? humanizeIdentifier(row.slug),
      providerKey: row.slug,
    }))
}

export async function listAdminCatalogResources(): Promise<AdminCatalogResource[]> {
  const appShell = resolveOverlayAppShellConfig()
  const providerCatalog = await listProviderCatalog().catch(() => [] as Awaited<ReturnType<typeof listProviderCatalog>>)

  return dedupeResources([
    ...AVAILABLE_MODELS.map((model) => ({
      category: `chat · ${model.provider}`,
      description: model.description,
      id: model.id,
      label: model.name,
      resourceType: 'model' as const,
    })),
    ...IMAGE_MODELS.map((model) => ({
      category: `image · ${model.provider}`,
      id: model.id,
      label: model.name,
      resourceType: 'model' as const,
    })),
    ...VIDEO_MODELS.map((model) => ({
      category: `video · ${model.provider}`,
      id: model.id,
      label: model.name,
      resourceType: 'model' as const,
    })),
    ...INTERNAL_API_TOOL_DEFINITIONS.map((tool) => ({
      category: tool.category,
      id: tool.id,
      label: humanizeIdentifier(tool.id),
      resourceType: 'tool' as const,
    })),
    ...appShell.integrations.map((integration) => ({
      category: 'connector',
      id: normalizeIntegrationProviderKey(integration.providerKey),
      label: integration.label,
      resourceType: 'connector' as const,
    })),
    ...providerCatalog.map((integration) => ({
      category: 'connector',
      description: integration.description,
      id: normalizeIntegrationProviderKey(integration.providerKey),
      label: integration.name,
      resourceType: 'connector' as const,
    })),
  ])
}

function dedupeResources(values: AdminCatalogResource[]): AdminCatalogResource[] {
  const unique = new Map<string, AdminCatalogResource>()
  for (const value of values) {
    unique.set(`${value.resourceType}:${value.id}`, value)
  }
  return [...unique.values()].sort(compareCatalogResources)
}

function compareCatalogResources(a: AdminCatalogResource, b: AdminCatalogResource): number {
  return compareResourceType(a.resourceType, b.resourceType)
    || a.label.localeCompare(b.label)
    || a.id.localeCompare(b.id)
}

function compareResourceType(a: AdminCatalogResourceType, b: AdminCatalogResourceType): number {
  return ['model', 'tool', 'connector'].indexOf(a) - ['model', 'tool', 'connector'].indexOf(b)
}

function humanizeIdentifier(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}
