import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getGatewayLanguageCatalog } from '@/server/ai/gateway/gateway-catalog'
import { getOverlayServerContext } from '@/server/bootstrap'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  const force = request.nextUrl.searchParams.get('refresh') === '1'
  const entitlements = await getOverlayServerContext().generationUsagePolicy.getEntitlements({
    userId: context.auth.userId,
  })
  if (!entitlements) return NextResponse.json({ error: 'Could not verify subscription.' }, { status: 401 })
  const authorized = await resolveAuthorizedModelIds({ entitlements })
  const models = (await getGatewayLanguageCatalog(force))
    .filter((model) => authorized.chat.has(model.id))
  return NextResponse.json({ models })
}
