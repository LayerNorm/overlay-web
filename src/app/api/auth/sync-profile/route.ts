import { logger } from '@/server/observability/logger'
import { NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { getOverlayServerContext } from '@/server/bootstrap'
import { captureProductEvent } from '@/server/observability/posthog-server'
import { contextForRequest, withObservabilityContext } from '@/server/observability/context'

export async function POST(request: Request) {
  try {
    return await withObservabilityContext(contextForRequest(request, { provider: 'auth' }), async () => {
      const session = await getOverlaySession(request)

      if (!session) {
        return NextResponse.json(
          { error: 'Not authenticated' },
          { status: 401 },
        )
      }

      const result = await getOverlayServerContext().userService.upsertFromSession(session)

      if (!result) {
        return NextResponse.json(
          { error: 'Failed to sync profile' },
          { status: 502 },
        )
      }

      if (!result.isNewUser) {
        captureProductEvent({
          name: 'auth.session.signed_in',
          properties: {},
          userId: result.userId,
        })
      }

      return NextResponse.json({
        success: true,
        isNewUser: result.isNewUser,
      })
    })
  } catch (error) {
    unstable_rethrow(error)
    logger.error('[Auth] Profile sync error:', error)
    return NextResponse.json(
      { error: 'Failed to sync profile' },
      { status: 500 }
    )
  }
}
