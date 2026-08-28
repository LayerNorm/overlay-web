import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getGatewayCatalog } from '@/server/ai/gateway/gateway-catalog'
import { getOverlayServerContext } from '@/server/bootstrap'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  const force = request.nextUrl.searchParams.get('refresh') === '1'
  const entitlements = await getOverlayServerContext().generationUsagePolicy.getEntitlements({
    userId: context.auth.userId,
  })
  if (!entitlements) return NextResponse.json({ error: 'Could not verify subscription.' }, { status: 401 })

  // Authorize after (or while) loading the full gateway catalog so the allowlist
  // is every language model from AI Gateway — not just the curated fallback list.
  const authorized = await resolveAuthorizedModelIds({
    entitlements,
    forceCatalogRefresh: force,
  })
  // Catalog is already warm from authorization; force was applied there when requested.
  const models = (await getGatewayCatalog(false)).filter((model) => (
    (model.type === 'language' && authorized.chat.has(model.id))
    || (model.type === 'image' && authorized.image.has(model.id))
    || (model.type === 'video' && authorized.video.has(model.id))
  ))
  return NextResponse.json({ models })
}
