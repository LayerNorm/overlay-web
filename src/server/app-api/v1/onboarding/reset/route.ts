import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  void request
  const { auth } = context
  if (context.appDataCapabilities.provider === 'postgres') {
    const result = await getOverlayServerContext()
      .appData
      .repositories
      .onboarding
      .reset(auth.userId)
    return NextResponse.json(result)
  }

  const result = await convex.mutation('auth/users:resetOnboarding', {
    serverSecret: getInternalApiSecret(),
    userId: auth.userId,
  })

  return NextResponse.json(result ?? { ok: false })
}
