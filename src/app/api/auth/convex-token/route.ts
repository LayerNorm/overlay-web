import { NextResponse } from 'next/server'
import { mintBrowserConvexAccessToken } from '@/server/auth/browser-convex-token'
import { getOverlaySession } from '@/server/auth/session'

/**
 * Issue a short-lived HS256 token for browser Convex queries/subscriptions.
 *
 * Convex queries cannot call fetch() to load WorkOS JWKS, so the browser must
 * not send the raw WorkOS access token into reactive queries. The BFF mints a
 * token signed with INTERNAL_API_SECRET (also present on Convex) that
 * requireAccessToken verifies with crypto.subtle only.
 */
export async function GET(request: Request) {
  const session = await getOverlaySession(request)
  if (!session?.user?.id || !session.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const token = await mintBrowserConvexAccessToken({ userId: session.user.id })
    return NextResponse.json(
      { token },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (_error) {
    return NextResponse.json({ error: 'Token mint failed' }, { status: 500 })
  }
}
