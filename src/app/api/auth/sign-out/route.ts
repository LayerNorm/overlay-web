import { logger } from '@/server/observability/logger'
import { NextResponse } from 'next/server'
import { clearOverlaySession } from '@/server/auth/session'

export async function POST(request: Request) {
  try {
    const signOutResult = await clearOverlaySession(request)
    const response = NextResponse.json({ success: true })
    forwardSetCookieHeaders(signOutResult, response)
    return response
  } catch (error) {
    logger.error('[Auth] Sign-out error:', error)
    return NextResponse.json(
      { error: 'Failed to sign out' },
      { status: 500 }
    )
  }
}

function forwardSetCookieHeaders(
  source: Response | Headers | void,
  target: NextResponse,
): void {
  if (!source) return
  const headers = source instanceof Response ? source.headers : source
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const cookieHeaders = typeof getSetCookie === 'function'
    ? getSetCookie.call(headers)
    : headers.get('set-cookie')
      ? [headers.get('set-cookie') as string]
      : []
  for (const cookie of cookieHeaders) {
    target.headers.append('set-cookie', cookie)
  }
}
