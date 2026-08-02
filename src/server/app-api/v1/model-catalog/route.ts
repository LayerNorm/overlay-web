import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getGatewayLanguageCatalog } from '@/server/ai/gateway/gateway-catalog'
import { getOverlayServerContext } from '@/server/bootstrap'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import { filterCatalogResources } from '@/server/authorization'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  const force = request.nextUrl.searchParams.get('refresh') === '1'
  const entitlements = await getOverlayServerContext().generationUsagePolicy.getEntitlements({
    userId: context.auth.userId,
  })
  if (!entitlements) return NextResponse.json({ error: 'Could not verify subscription.' }, { status: 401 })

  // Two independent gates, both required. The server model policy decides which
  // models this plan may use at all; resource authorization then decides which
  // of those this subject may use. Neither substitutes for the other.
  const authorized = await resolveAuthorizedModelIds({
    entitlements,
    forceCatalogRefresh: force,
  })
  // Catalog is already warm from authorization; force was applied there when requested.
  const policyAllowed = (await getGatewayLanguageCatalog(false))
    .filter((model) => authorized.chat.has(model.id))
  const models = await filterCatalogResources({
    authorization: getOverlayServerContext().authorizationService,
    capability: 'models.use',
    context,
    getId: (model) => model.id,
    resourceType: 'model',
    values: policyAllowed,
  })
  return NextResponse.json({ models })
}
