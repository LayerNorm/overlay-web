import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getGatewayCatalog } from '@/server/ai/gateway/gateway-catalog'
import { getOverlayServerContext } from '@/server/bootstrap'
import { resolveCatalogModelIds } from '@/server/ai/model-policy-authority'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  const force = request.nextUrl.searchParams.get('refresh') === '1'
  const entitlements = await getOverlayServerContext().generationUsagePolicy.getEntitlements({
    userId: context.auth.userId,
  })
  if (!entitlements) return NextResponse.json({ error: 'Could not verify subscription.' }, { status: 401 })

  // Listing metadata is separate from the entitlement checks on generation.
  const catalog = await resolveCatalogModelIds({
    entitlements,
    forceCatalogRefresh: force,
  })
  // Catalog is already warm; force was applied there when requested.
  const models = (await getGatewayCatalog(false)).filter((model) => (
    (model.type === 'language' && catalog.chat.has(model.id))
    || (model.type === 'image' && catalog.image.has(model.id))
    || (model.type === 'video' && catalog.video.has(model.id))
  ))
  return NextResponse.json({ models })
}
