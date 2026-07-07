import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { NextResponse } from 'next/server'
import { getOverlaySession } from '@/server/auth/session'
import { convex } from '@/server/database/convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ONBOARDING_SEEN_COOKIE } from '@/features/auth/lib/onboarding-cookie'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  const session = await getOverlaySession(request)
  const { auth } = context
  const userId = auth.userId

  const cookieStore = await cookies()
  const cookieUid = cookieStore.get(ONBOARDING_SEEN_COOKIE)?.value
  if (cookieUid === userId) {
    return NextResponse.json({ hasSeenOnboarding: true })
  }

  const result = (await convex.query('auth/users:getOnboardingStatus', {
    serverSecret: getInternalApiSecret(),
    userId,
  })) as { hasSeenOnboarding?: boolean } | null

  const hasSeen = Boolean(result?.hasSeenOnboarding)
  const response = NextResponse.json(result ?? { hasSeenOnboarding: false })

  // Heal: Convex says done but cookie missing (new browser, cleared cookies once, etc.)
  if (session?.user?.id === userId && hasSeen && cookieUid !== userId) {
    response.cookies.set(ONBOARDING_SEEN_COOKIE, userId, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    })
  }

  return response
}
