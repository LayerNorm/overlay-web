import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import {
  consumeAuthorizationState,
  handleCallback,
  getBaseUrl,
  MOBILE_AUTH_REDIRECT_PATH,
} from '@/server/auth/actions'
import { getOverlaySession } from '@/server/auth/session'
import { logAuthDebug, summarizeSessionForLog } from '@/server/auth/auth-debug'
import { convex as serverConvex } from '@/server/database/convex'
import { createHash, randomBytes } from 'crypto'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { encryptSessionTransferPayload } from '@/server/auth/session-transfer-crypto'

const SESSION_TRANSFER_TTL_MS = 90 * 1000

function hashTransferTokenForLog(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // Handle OAuth errors
  if (error) {
    const errorMsg = encodeURIComponent(errorDescription || error)
    return NextResponse.redirect(`${getBaseUrl()}/auth/sign-in?error=${errorMsg}`)
  }

  if (!code) {
    return NextResponse.redirect(`${getBaseUrl()}/auth/sign-in?error=No authorization code received`)
  }

  try {
    logAuthDebug('/api/auth/callback start', {
      hasCode: Boolean(code),
      hasState: Boolean(state),
    })
    const authState = await consumeAuthorizationState(state)
    if (!authState) {
      return NextResponse.redirect(`${getBaseUrl()}/auth/sign-in?error=Invalid or expired authentication state`)
    }
    const result = await handleCallback(code)

    if (!result.success || !result.user) {
      const errorMsg = encodeURIComponent(result.error || 'Authentication failed')
      return NextResponse.redirect(`${getBaseUrl()}/auth/sign-in?error=${errorMsg}`)
    }

    // Sync user profile to Convex (creates subscription record if it doesn't exist)
    const session = await getOverlaySession(request)
    logAuthDebug('/api/auth/callback post-handleCallback session', summarizeSessionForLog(session))

    const inspectAccessToken = async (accessToken: string, userId: string) => {
      try {
        return await serverConvex.query<Record<string, unknown>>('auth/authDebug:inspectAccessToken', {
          serverSecret: getInternalApiSecret(),
          accessToken,
          userId,
        })
      } catch (inspectionError) {
        return {
          inspectionFailed: true,
          error: inspectionError instanceof Error ? inspectionError.message : String(inspectionError),
        }
      }
    }

    let isNewUser = false
    try {
      if (session?.accessToken) {
        logAuthDebug('/api/auth/callback syncUserProfile start', {
          callbackUserId: result.user.id,
          session: summarizeSessionForLog(session),
          convexInspection: await inspectAccessToken(session.accessToken, result.user.id),
        })
        const syncResult = await serverConvex.mutation<{ success: boolean; isNewUser: boolean }>('auth/users:syncUserProfileByServer', {
          serverSecret: getInternalApiSecret(),
          userId: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          profilePictureUrl: result.user.profilePictureUrl,
        }, { throwOnError: true })
        isNewUser = syncResult?.isNewUser ?? false
        logAuthDebug('/api/auth/callback syncUserProfile success', {
          callbackUserId: result.user.id,
          isNewUser,
        })
        logger.info('[Auth] User profile synced to Convex:', result.user.id, { isNewUser })
      }
    } catch (syncError) {
      logAuthDebug('/api/auth/callback syncUserProfile error', {
        callbackUserId: result.user.id,
        error: syncError instanceof Error ? syncError.message : String(syncError),
        session: summarizeSessionForLog(session),
        convexInspection: session?.accessToken
          ? await inspectAccessToken(session.accessToken, result.user.id)
          : null,
      })
      logger.error('[Auth] Failed to sync user profile:', syncError)
      // Continue anyway - user can still use the app
    }

    const redirectTo = authState.redirectTo

    // Handle mobile app auth: generate a transfer token and deep link directly
    // instead of redirecting to a separate page that may not be deployed.
    if (redirectTo === MOBILE_AUTH_REDIRECT_PATH && session) {
      try {
        if (!authState.codeChallenge) {
          return NextResponse.redirect(`${getBaseUrl()}/auth/sign-in?error=Missing native auth code challenge`)
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

        await serverConvex.mutation('auth/sessionTransfer:storeToken', {
          serverSecret: getInternalApiSecret(),
          token,
          codeChallenge: authState.codeChallenge,
          data: encryptSessionTransferPayload(JSON.stringify(authData)),
          expiresAt,
        })

        logger.info('[Auth] Created mobile session transfer token', {
          userId: session.user.id,
          tokenHashPrefix: hashTransferTokenForLog(token),
          expiresAt,
        })

        return NextResponse.redirect(`overlay://auth/transfer?token=${token}`)
      } catch (mobileError) {
        logger.error('[Auth] Failed to generate mobile transfer token:', mobileError)
        // Fall through to redirect to the page which shows a user-friendly error
      }
    }

    const finalRedirect = new URL(redirectTo, getBaseUrl())
    if (isNewUser) {
      finalRedirect.searchParams.set('onboarding', '1')
    }
    return NextResponse.redirect(finalRedirect)
  } catch (error) {
    logger.error('[Auth] Callback error:', error)
    return NextResponse.redirect(`${getBaseUrl()}/auth/sign-in?error=Authentication failed`)
  }
}
