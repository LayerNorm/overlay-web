import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import type { Id } from '../../../../../../convex/_generated/dataModel'

function buildShareUrl(request: NextRequest, token: string): string {
  const origin =
    request.headers.get('origin') ||
    `${request.nextUrl.protocol}//${request.nextUrl.host}`
  return `${origin.replace(/\/$/, '')}/share/c/${token}`
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = (await request.json().catch((_error) => ({}))) as {
      conversationId?: string
      visibility?: 'private' | 'public'
      accessToken?: string
      userId?: string
    }
    const { auth } = context
    if (!body.conversationId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
    }
    if (body.visibility !== 'private' && body.visibility !== 'public') {
      return NextResponse.json({ error: 'visibility must be "private" or "public"' }, { status: 400 })
    }
    const serverSecret = getInternalApiSecret()
    const result = await convex.mutation<{ token: string | null; visibility: 'private' | 'public' }>(
      'chat/conversations:setShare',
      {
        conversationId: body.conversationId as Id<'conversations'>,
        userId: auth.userId,
        serverSecret,
        visibility: body.visibility,
      },
    )
    if (!result) {
      return NextResponse.json({ error: 'Failed to update share visibility' }, { status: 500 })
    }
    return NextResponse.json({
      visibility: result.visibility,
      token: result.token,
      url: result.token ? buildShareUrl(request, result.token) : null,
    })
  } catch (error) {
    logger.error('[conversations/share PATCH]', error)
    return NextResponse.json({ error: 'Failed to update share visibility' }, { status: 500 })
  }
}
