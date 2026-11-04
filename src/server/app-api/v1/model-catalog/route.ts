import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getGatewayCatalog } from '@/server/ai/gateway/gateway-catalog'
import { getOverlayServerContext } from '@/server/bootstrap'
import { resolveCatalogModelIds } from '@/server/ai/model-policy-authority'
import { BillingPayerResolutionError } from '@/server/billing/BillingPayerResolver'

type Dependencies = {
  getEntitlements: ReturnType<typeof getOverlayServerContext>['generationUsagePolicy']['getEntitlements']
  resolveCatalog: typeof resolveCatalogModelIds
  getCatalog: typeof getGatewayCatalog
}

export async function GET(request: NextRequest, context: AppApiRouteContext, dependencies?: Dependencies) {
  const force = request.nextUrl.searchParams.get('refresh') === '1'
  const usagePolicy = dependencies ? null : getOverlayServerContext().generationUsagePolicy
  const getEntitlements = dependencies?.getEntitlements ?? usagePolicy!.getEntitlements.bind(usagePolicy!)
  const entitlements = await getEntitlements({
    userId: context.auth.userId,
    workspaceId: context.workspace.workspace.id,
  }).catch((error: unknown) => {
    if (error instanceof BillingPayerResolutionError && error.code === 'workspace_wallet_not_configured') return null
    throw error
  })

  // Listing metadata is separate from the entitlement checks on generation.
  const catalog = await (dependencies?.resolveCatalog ?? resolveCatalogModelIds)({
    entitlements,
    forceCatalogRefresh: force,
  })
  // Catalog is already warm; force was applied there when requested.
  const models = (await (dependencies?.getCatalog ?? getGatewayCatalog)(false)).filter((model) => (
    (model.type === 'language' && catalog.chat.has(model.id))
    || (model.type === 'image' && catalog.image.has(model.id))
    || (model.type === 'video' && catalog.video.has(model.id))
  ))
  return NextResponse.json({ models })
}
