import { NextRequest, NextResponse } from 'next/server'
import { getNativeAuthorizationUrl, normalizeCodeChallenge } from '@/server/auth/actions'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { logSecurityEvent } from '@/server/observability/security-events'
import {
  isAllowedNativeRedirectUri,
  isAllowedWorkOsAuthorizationUrl,
  isNativeAuthProvider,
  isValidNativeAuthState,
} from '@/server/auth/native-auth-validation'
import { requireOverlayCapability } from '@/server/capabilities'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
} as const

export async function POST(request: NextRequest) {
  try {
    const disabledCapabilityResponse = await requireOverlayCapability('sso')
    if (disabledCapabilityResponse) return disabledCapabilityResponse

    const rateLimitResponse = await enforceRateLimits(request, [
      { bucket: 'auth:native-authorize:ip', key: getClientIp(request), limit: 30, windowMs: 10 * 60_000 },
    ])
    if (rateLimitResponse) return rateLimitResponse

    const body = await request.json().catch((_error) => ({})) as {
      provider?: unknown
      redirectUri?: unknown
      codeChallenge?: unknown
      state?: unknown
      forceSignIn?: unknown
    }

    // The native client intentionally does not select an auth implementation.
    // The selected Overlay Server owns that policy.
    const provider = typeof body.provider === 'string' ? body.provider.trim() : 'authkit'
    const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri.trim() : ''
    const codeChallenge = typeof body.codeChallenge === 'string' ? normalizeCodeChallenge(body.codeChallenge) : null
    const state = typeof body.state === 'string' ? body.state.trim() : ''

    if (!isNativeAuthProvider(provider)) {
      logSecurityEvent('native_authorize_rejected', {
        reason: 'unsupported_provider',
        path: request.nextUrl.pathname,
        ip: getClientIp(request),
      }, 'warning')
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    if (!isAllowedNativeRedirectUri(redirectUri, request.nextUrl.origin)) {
      logSecurityEvent('native_authorize_rejected', {
        reason: 'invalid_redirect_uri',
        path: request.nextUrl.pathname,
        ip: getClientIp(request),
      }, 'warning')
      return NextResponse.json({ error: 'Invalid native redirect URI' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    if (!codeChallenge || !isValidNativeAuthState(state)) {
      logSecurityEvent('native_authorize_rejected', {
        reason: !codeChallenge ? 'invalid_code_challenge' : 'invalid_state',
        path: request.nextUrl.pathname,
        ip: getClientIp(request),
      }, 'warning')
      return NextResponse.json({ error: 'Missing native PKCE state' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const authorizationUrl = await getNativeAuthorizationUrl(
      provider,
      {
        redirectUri,
        codeChallenge,
        state,
        forceSignIn: body.forceSignIn === true,
      },
    )

    if (!isAllowedWorkOsAuthorizationUrl(authorizationUrl)) {
      logSecurityEvent('native_authorize_error', {
        reason: 'unexpected_authorization_url_origin',
        path: request.nextUrl.pathname,
        ip: getClientIp(request),
      }, 'error')
      return NextResponse.json({ error: 'Failed to create authorization URL' }, { status: 500, headers: NO_STORE_HEADERS })
    }

    return NextResponse.json({ authorizationUrl }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const isUnsupportedBetterAuthNative = message.startsWith('Native Better Auth')
    logSecurityEvent('native_authorize_error', {
      reason: message,
      path: request.nextUrl.pathname,
      ip: getClientIp(request),
    }, isUnsupportedBetterAuthNative ? 'warning' : 'error')
    if (isUnsupportedBetterAuthNative) {
      return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS })
    }
    return NextResponse.json({ error: 'Failed to create authorization URL' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
