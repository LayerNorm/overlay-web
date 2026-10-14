import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { INTERNAL_API_TOOL_DEFINITIONS } from '@overlay/tools-core'
import {
  AVAILABLE_MODELS,
  IMAGE_MODELS,
  VIDEO_MODELS,
} from '@/shared/ai/gateway/model-data'
import {
  normalizeIntegrationProviderKey,
  resolveOverlayAppShellConfig,
} from '@overlay/app-core'
import { handleAdminRoute as handleBffRoute, type AdminDomainService as BffDomainService } from '../_utils'

// Local copy of the api-client's catalog resource contract — the admin app
// cannot import @overlay/api-client (it reaches into web src/**).
export type AdminCatalogResourceType = 'model' | 'tool' | 'connector'
export type AdminCatalogResource = {
  category?: string
  description?: string
  id: string
  label: string
  resourceType: AdminCatalogResourceType
}

const listCatalog: BffDomainService = async (_request, _context) => {
  // The web route merges in a Composio provider catalog; that requires
  // COMPOSIO_API_KEY, which the admin app never holds (the web route already
  // fail-softs to [] without it). Connector resources therefore come only
  // from the static app shell registry — same baseline set the web uses.
  const appShell = resolveOverlayAppShellConfig()
  const resources = dedupeResources([
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
  ])

  return NextResponse.json({ resources })
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listCatalog)
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
