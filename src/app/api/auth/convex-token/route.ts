import { NextResponse } from 'next/server'
import { mintBrowserConvexAccessToken } from '@/server/auth/browser-convex-token'
import { getOverlaySession } from '@/server/auth/session'
import { getOverlayServerContext } from '@/server/bootstrap'
import { resolveNativeConvexToken } from '@/server/auth/native-convex-token'

const headers = { 'Cache-Control': 'no-store, max-age=0', Vary: 'Cookie, Authorization' }

// Legacy query-argument tokens and native platform identity tokens are distinct.
export async function GET(request: Request) {
  const session = await getOverlaySession(request)
  if (!session?.user?.id || !session.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  }
  try {
    if (new URL(request.url).searchParams.get('native') === '1') {
      const auth = getOverlayServerContext().auth
      const token = await resolveNativeConvexToken(session, (value) => auth.verifyAccessToken(value))
      if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
      return NextResponse.json({ token, userId: session.user.id }, { headers })
    }
    const token = await mintBrowserConvexAccessToken({ userId: session.user.id })
    return NextResponse.json(
      { token, userId: session.user.id },
      { headers },
    )
  } catch (_error) {
    return NextResponse.json({ error: 'Token unavailable' }, { status: 503, headers })
  }
}
