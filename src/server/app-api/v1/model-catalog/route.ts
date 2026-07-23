import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getGatewayLanguageCatalog } from '@/server/ai/gateway/gateway-catalog'
import { getOverlayServerContext } from '@/server/bootstrap'
import { filterCatalogResources } from '@/server/authorization'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  const force = request.nextUrl.searchParams.get('refresh') === '1'
  const models = await getGatewayLanguageCatalog(force)
  const authorization = getOverlayServerContext().authorizationService
  const allowedModels = await filterCatalogResources({
    authorization,
    capability: 'models.use',
    context,
    getId: (model) => model.id,
    resourceType: 'model',
    values: models,
  })
  return NextResponse.json({ models: allowedModels })
}
