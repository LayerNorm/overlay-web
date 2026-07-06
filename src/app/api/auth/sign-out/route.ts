import { logger } from '@/server/observability/logger'
import { NextResponse } from 'next/server'
import { clearOverlaySession } from '@/server/auth/session'

export async function POST(request: Request) {
  try {
    await clearOverlaySession(request)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[Auth] Sign-out error:', error)
    return NextResponse.json(
      { error: 'Failed to sign out' },
      { status: 500 }
    )
  }
}
