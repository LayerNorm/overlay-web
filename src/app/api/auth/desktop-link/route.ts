import { logger } from '@/server/observability/logger'
import { NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { createHash, randomBytes } from 'crypto'
import { convex } from '@/server/database/convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import {
  decryptSessionTransferPayload,
  encryptSessionTransferPayload,
} from '@/server/auth/session-transfer-crypto'
import { normalizeCodeChallenge } from '@/server/auth/actions'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
} as const

const SESSION_TRANSFER_TTL_MS = 90 * 1000

function getAllowedChromeExtensionIds(): Set<string> {
  return new Set(
    (process.env.OVERLAY_CHROME_EXTENSION_IDS ?? process.env.NEXT_PUBLIC_OVERLAY_CHROME_EXTENSION_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^[a-p]{32}$/.test(id)),
  )
}

function hashTransferTokenForLog(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12)
}

export async function POST(request: Request) {
  try {
    const session = await getOverlaySession(request)
    
    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // The desktop/mobile apps need a usable refresh token + expiry to keep the
    // transferred session alive. A web session without them cannot be handed off.
    if (!session.refreshToken || typeof session.expiresAt !== 'number') {
      return NextResponse.json(
        { error: 'Session cannot be transferred' },
        { status: 409, headers: NO_STORE_HEADERS }
      )
    }

    const requestBody = await request.json().catch((_error) => ({})) as {
      codeChallenge?: unknown
      chromeExtensionId?: unknown
    }
    const chromeExtensionId =
      typeof requestBody.chromeExtensionId === 'string' ? requestBody.chromeExtensionId.trim() : ''
    if (chromeExtensionId) {
      const allowedIds = getAllowedChromeExtensionIds()
      if (!allowedIds.has(chromeExtensionId)) {
        return NextResponse.json(
          { error: 'Chrome extension is not allowed' },
          { status: 403, headers: NO_STORE_HEADERS },
        )
      }
    }
    const codeChallenge = normalizeCodeChallenge(
      typeof requestBody.codeChallenge === 'string'
        ? requestBody.codeChallenge
        : null,
    )
    if (!codeChallenge) {
      return NextResponse.json(
        { error: 'A valid codeChallenge is required' },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    const authData = {
      userId: session.user.id,
      email: session.user.email,
      firstName: session.user.firstName || '',
      lastName: session.user.lastName || '',
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    }

    const token = randomBytes(16).toString('hex')
    const expiresAt = Date.now() + SESSION_TRANSFER_TTL_MS

    await convex.mutation('auth/sessionTransfer:storeToken', {
      serverSecret: getInternalApiSecret(),
      token,
      codeChallenge,
      data: encryptSessionTransferPayload(JSON.stringify(authData)),
      expiresAt,
    })

    logger.info('[Desktop Link] Created session transfer token', {
      userId: session.user.id,
      tokenHashPrefix: hashTransferTokenForLog(token),
      expiresAt,
      hasCodeChallenge: Boolean(codeChallenge),
    })

    const requestOrigin = new URL(request.url).origin
    const deepLink = `overlay://auth/transfer?token=${encodeURIComponent(token)}&server=${encodeURIComponent(requestOrigin)}`

    return NextResponse.json({ deepLink }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    unstable_rethrow(error)
    logger.error('[Desktop Link] Error:', summarizeErrorForLog(error))
    return NextResponse.json(
      { error: 'Failed to generate desktop link' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')?.trim()
    const codeVerifier = request.headers.get('x-overlay-code-verifier')?.trim() || undefined
    
    if (!token) {
      return NextResponse.json(
        { error: 'Token required' },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }
    if (!codeVerifier) {
      return NextResponse.json(
        { error: 'Code verifier required' },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    const dataJson = await convex.mutation<string>('auth/sessionTransfer:consumeToken', {
      token,
      codeVerifier,
      serverSecret: getInternalApiSecret(),
    })

    if (!dataJson) {
      logger.warn('[Desktop Link] Session transfer consume rejected', {
        tokenHashPrefix: hashTransferTokenForLog(token),
        hasCodeVerifier: Boolean(codeVerifier),
      })
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 404, headers: NO_STORE_HEADERS }
      )
    }

    const data = JSON.parse(decryptSessionTransferPayload(dataJson))
    logger.info('[Desktop Link] Session transfer consumed', {
      tokenHashPrefix: hashTransferTokenForLog(token),
      userId: typeof data?.userId === 'string' ? data.userId : null,
      hasCodeVerifier: Boolean(codeVerifier),
    })
    return NextResponse.json(data, { headers: NO_STORE_HEADERS })
  } catch (error) {
    logger.error('[Desktop Link] Error retrieving session:', summarizeErrorForLog(error))
    return NextResponse.json(
      { error: 'Failed to retrieve session' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
