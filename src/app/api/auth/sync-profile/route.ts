import { logger } from '@/server/observability/logger'
import { NextResponse } from 'next/server'
import { getOverlaySession } from '@/server/auth/session'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getPostHogClient } from '@/server/observability/posthog-server'

export async function POST(request: Request) {
  try {
    const session = await getOverlaySession(request)
    
    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const result = await getOverlayServerContext().userService.upsertFromSession(session)

    if (!result) {
      return NextResponse.json(
        { error: 'Failed to sync profile' },
        { status: 502 }
      )
    }

    const posthog = getPostHogClient()
    if (posthog) {
      if (result.isNewUser) {
        posthog.capture({
          distinctId: session.user.id,
          event: 'user_signed_up',
          properties: {
            email: session.user.email,
            first_name: session.user.firstName,
            last_name: session.user.lastName,
          },
        })
      } else {
        posthog.capture({
          distinctId: session.user.id,
          event: 'user_signed_in',
          properties: {
            email: session.user.email,
          },
        })
      }
      posthog.identify({
        distinctId: session.user.id,
        properties: {
          email: session.user.email,
          first_name: session.user.firstName,
          last_name: session.user.lastName,
        },
      })
    }

    return NextResponse.json({
      success: true,
      isNewUser: result.isNewUser,
    })
  } catch (error) {
    logger.error('[Auth] Profile sync error:', error)
    return NextResponse.json(
      { error: 'Failed to sync profile' },
      { status: 500 }
    )
  }
}
