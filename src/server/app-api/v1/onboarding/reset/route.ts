import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ONBOARDING_SEEN_COOKIE } from '@/features/auth/lib/onboarding-cookie'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  void request
  const { auth } = context
  const result = await convex.mutation('auth/users:resetOnboarding', {
    serverSecret: getInternalApiSecret(),
    userId: auth.userId,
  })

  if (!result || typeof result !== 'object' || !('ok' in result) || !(result as { ok: boolean }).ok) {
    return NextResponse.json({ ok: false }, { status: 503 })
  }
  const response = NextResponse.json(result)
  response.cookies.delete(ONBOARDING_SEEN_COOKIE)
  return response
}
