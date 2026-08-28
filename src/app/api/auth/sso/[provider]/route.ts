import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import {
  getAuthUiOptions,
  getAuthorizationRedirectResponse,
  normalizeAuthRedirect,
  normalizeCodeChallenge,
} from '@/server/auth/actions'
import { requireOverlayCapability } from '@/server/capabilities'
import { isCurrentLegalAcceptance } from '@/shared/legal/legal-documents'
import {
  encodePendingLegalAcceptance,
  PENDING_LEGAL_ACCEPTANCE_COOKIE,
} from '@/server/legal/pending-legal-acceptance'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const disabledCapabilityResponse = await requireOverlayCapability('sso')
  if (disabledCapabilityResponse) return disabledCapabilityResponse

  const { provider } = await params
  const { searchParams } = new URL(request.url)
  const redirectUri = searchParams.get('redirect') || undefined
  const normalizedRedirectUri = normalizeAuthRedirect(redirectUri)
  const codeChallenge = normalizeCodeChallenge(searchParams.get('codeChallenge'))
  const forceSignIn = searchParams.get('force') === 'true'
  const isSignUp = searchParams.get('intent') === 'signup'
  const legalAcceptanceCandidate = {
    acceptedLegalTerms: searchParams.get('acceptedLegalTerms') === 'true',
    termsVersion: searchParams.get('termsVersion'),
    privacyVersion: searchParams.get('privacyVersion'),
  }
  if (isSignUp && !isCurrentLegalAcceptance(legalAcceptanceCandidate)) {
    return NextResponse.json(
      { error: 'You must accept the current Terms of Service and Privacy Policy to continue.' },
      { status: 400 },
    )
  }
  const legalAcceptance = isCurrentLegalAcceptance(legalAcceptanceCandidate)
    ? legalAcceptanceCandidate
    : null
  
  // Also force sign-in when redirecting to desktop app (overlay:// protocol)
  const isDesktopAuth = redirectUri?.startsWith('overlay://')

  const authOptions = getAuthUiOptions()
  if (!authOptions.ssoProviders.some((option) => option.id === provider)) {
    return NextResponse.json(
      { error: 'Invalid or unavailable SSO provider.' },
      { status: 400 }
    )
  }

  if (redirectUri && normalizedRedirectUri === null) {
    return NextResponse.json(
      { error: 'Invalid redirect URI' },
      { status: 400 }
    )
  }
  if (searchParams.has('codeChallenge') && !codeChallenge) {
    return NextResponse.json(
      { error: 'Invalid codeChallenge' },
      { status: 400 }
    )
  }

  try {
    logger.info('[Auth] SSO request:', { provider, redirectUri, forceSignIn, isDesktopAuth })
    
    const response = await getAuthorizationRedirectResponse(
      request,
      provider,
      {
        redirectUri: normalizedRedirectUri ?? undefined,
        forceSignIn: forceSignIn || isDesktopAuth,
        codeChallenge,
      },
    )

    logger.info('[Auth] Generated auth URL, redirecting...')
    if (legalAcceptance) {
      response.cookies.set(PENDING_LEGAL_ACCEPTANCE_COOKIE, encodePendingLegalAcceptance(legalAcceptance), {
        httpOnly: true,
        maxAge: 10 * 60,
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      })
    }
    return response
  } catch (error) {
    logger.error('[Auth] SSO error details:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      provider,
      redirectUri,
      forceSignIn
    })
    return NextResponse.json(
      { error: 'Failed to initiate SSO', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
