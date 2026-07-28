import 'server-only'

import { NextResponse } from 'next/server'
import { getAuthUiOptionsForConfig } from '@/server/auth/auth-ui-options'
import { getBetterAuth, resolveBetterAuthRuntimeConfig } from '@/server/auth/better-auth'
import * as workosAuth from '@/server/auth/workos-auth'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import type { AuthUiOptions } from '@/shared/auth/auth-ui-options'
import type { AuthSession, AuthUser } from '@/shared/auth/session-types'
import type { RefreshSessionResult } from '@/server/auth/refresh-session-result'

type WorkOsSsoProvider = 'GoogleOAuth' | 'AppleOAuth' | 'MicrosoftOAuth'
export type PublicSsoProvider = string
export type NativeAuthProvider = WorkOsSsoProvider | 'authkit'
export type { AuthUiOptions }

type StartSsoOptions = {
  provider: PublicSsoProvider
  redirectUri?: string
  forceSignIn?: boolean
  codeChallenge?: string | null
}

type NativeAuthorizationOptions = {
  redirectUri: string
  codeChallenge: string
  state: string
  forceSignIn?: boolean
}

type PasswordAuthResult = {
  success: boolean
  user?: AuthUser
  error?: string
  pendingEmailVerification?: boolean
}

type SignUpResult = PasswordAuthResult & {
  verificationTicket?: string
}

type EmailVerificationTicket = ReturnType<typeof workosAuth.readEmailVerificationTicket>

interface WebAuthFlowProvider {
  getOptions(): AuthUiOptions
  startSso(request: Request, options: StartSsoOptions): Promise<Response>
  getNativeAuthorizationUrl(provider: NativeAuthProvider, options: NativeAuthorizationOptions): Promise<string>
  authenticateNativeWithCode(code: string, codeVerifier: string): Promise<AuthSession>
  signInWithPassword(email: string, password: string): Promise<PasswordAuthResult>
  signUpWithPassword(email: string, password: string, firstName?: string, lastName?: string): Promise<SignUpResult>
  handleCallback(code: string): Promise<{ success: boolean; user?: AuthUser; error?: string }>
  sendPasswordResetEmail(email: string): Promise<{ success: boolean; error?: string }>
  resetPassword(token: string, newPassword: string): Promise<{ success: boolean; error?: string }>
  readEmailVerificationTicket(value: string): EmailVerificationTicket
  verifyEmail(userId: string, code: string): Promise<{ success: boolean; error?: string }>
  resendVerificationEmail(userId: string): Promise<{ success: boolean; error?: string }>
  refreshSessionFromRefreshToken(refreshToken: string, expectedUserId?: string): Promise<AuthSession | null>
  refreshSessionFromRefreshTokenResult(
    refreshToken: string,
    expectedUserId?: string,
  ): Promise<RefreshSessionResult>
}

const WORKOS_SSO_PROVIDERS: Array<{
  id: string
  label: string
  icon: 'google' | 'apple' | 'microsoft'
  workosProvider: WorkOsSsoProvider
}> = [
  { id: 'google', label: 'Continue with Google', icon: 'google', workosProvider: 'GoogleOAuth' },
  { id: 'apple', label: 'Continue with Apple', icon: 'apple', workosProvider: 'AppleOAuth' },
  { id: 'microsoft', label: 'Continue with Microsoft', icon: 'microsoft', workosProvider: 'MicrosoftOAuth' },
]

class WorkOsWebAuthFlowProvider implements WebAuthFlowProvider {
  getOptions(): AuthUiOptions {
    return getAuthUiOptionsForConfig(getOverlayRuntimeConfigSync())
  }

  async startSso(
    _request: Request,
    options: StartSsoOptions,
  ): Promise<Response> {
    const provider = WORKOS_SSO_PROVIDERS.find((entry) => entry.id === options.provider)
    if (!provider) {
      throw new Error('Unsupported SSO provider for WorkOS auth.')
    }
    return NextResponse.redirect(await workosAuth.getAuthorizationUrl(provider.workosProvider, options))
  }

  getNativeAuthorizationUrl(provider: NativeAuthProvider, options: NativeAuthorizationOptions): Promise<string> {
    return workosAuth.getNativeAuthorizationUrl(provider, options)
  }

  authenticateNativeWithCode(code: string, codeVerifier: string): Promise<AuthSession> {
    return workosAuth.authenticateNativeWithCode(code, codeVerifier)
  }

  signInWithPassword(email: string, password: string): Promise<PasswordAuthResult> {
    return workosAuth.authenticateWithPassword(email, password)
  }

  signUpWithPassword(email: string, password: string, firstName?: string, lastName?: string): Promise<SignUpResult> {
    return workosAuth.createUser(email, password, firstName, lastName)
  }

  handleCallback(code: string): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
    return workosAuth.handleCallback(code)
  }

  sendPasswordResetEmail(email: string): Promise<{ success: boolean; error?: string }> {
    return workosAuth.sendPasswordResetEmail(email)
  }

  resetPassword(token: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    return workosAuth.resetPassword(token, newPassword)
  }

  readEmailVerificationTicket(value: string): EmailVerificationTicket {
    return workosAuth.readEmailVerificationTicket(value)
  }

  verifyEmail(userId: string, code: string): Promise<{ success: boolean; error?: string }> {
    return workosAuth.verifyEmail(userId, code)
  }

  resendVerificationEmail(userId: string): Promise<{ success: boolean; error?: string }> {
    return workosAuth.resendVerificationEmail(userId)
  }

  refreshSessionFromRefreshToken(refreshToken: string, expectedUserId?: string): Promise<AuthSession | null> {
    return workosAuth.refreshSessionFromRefreshToken(refreshToken, expectedUserId)
  }

  refreshSessionFromRefreshTokenResult(
    refreshToken: string,
    expectedUserId?: string,
  ): Promise<RefreshSessionResult> {
    return workosAuth.refreshSessionFromRefreshTokenResult(refreshToken, expectedUserId)
  }
}

class BetterAuthWebAuthFlowProvider implements WebAuthFlowProvider {
  getOptions(): AuthUiOptions {
    return getAuthUiOptionsForConfig(getOverlayRuntimeConfigSync())
  }

  async startSso(
    request: Request,
    options: StartSsoOptions,
  ): Promise<Response> {
    void options.forceSignIn
    const config = getOverlayRuntimeConfigSync()
    const betterAuthConfig = resolveBetterAuthRuntimeConfig(config)
    const connection = betterAuthConfig.connections.find(
      (candidate) => candidate.id === options.provider,
    )
    if (!connection) {
      throw new Error('Unsupported SSO provider for Better Auth.')
    }
    const normalizedRedirectUri = workosAuth.normalizeAuthRedirect(options.redirectUri)
    if (options.redirectUri && normalizedRedirectUri === null) {
      throw new Error('Invalid redirect URI')
    }
    if (options.codeChallenge) {
      throw new Error('Native Better Auth session transfer is not supported in this auth provider version.')
    }

    const callbackURL = new URL(normalizedRedirectUri ?? '/', betterAuthConfig.baseUrl).toString()
    const errorCallbackURL = new URL(
      '/auth/sign-in?error=Authentication%20failed',
      betterAuthConfig.baseUrl,
    ).toString()
    const body: Record<string, unknown> = {
      callbackURL,
      errorCallbackURL,
      providerId: connection.id,
    }

    const headers = new Headers()
    headers.set('content-type', 'application/json')
    headers.set('origin', request.headers.get('origin') ?? new URL(betterAuthConfig.baseUrl).origin)
    const referer = request.headers.get('referer')
    if (referer) headers.set('referer', referer)
    const cookie = request.headers.get('cookie')
    if (cookie) headers.set('cookie', cookie)

    const response = await getBetterAuth(config).handler(new Request(
      `${betterAuthConfig.baseUrl}${betterAuthConfig.basePath}/sign-in/sso`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
    ))

    if (!response.ok) {
      const text = await response.text().catch((_error) => '')
      throw new Error(text || `Better Auth SSO initiation failed with HTTP ${response.status}`)
    }

    const payload = await response.json() as { url?: unknown }
    if (typeof payload.url !== 'string' || !payload.url) {
      throw new Error('Better Auth did not return an authorization URL.')
    }

    const redirect = NextResponse.redirect(payload.url)
    forwardSetCookieHeaders(response, redirect)
    return redirect
  }

  getNativeAuthorizationUrl(): Promise<string> {
    throw new Error('Native Better Auth code exchange is not supported in this auth provider version.')
  }

  authenticateNativeWithCode(): Promise<AuthSession> {
    throw new Error('Native Better Auth code exchange is not supported in this auth provider version.')
  }

  async signInWithPassword(): Promise<PasswordAuthResult> {
    return betterAuthPasswordDisabled()
  }

  async signUpWithPassword(): Promise<SignUpResult> {
    return {
      success: false,
      error: 'Email/password sign-up is disabled when AUTH_PROVIDER=better-auth. Use SSO.',
    }
  }

  async handleCallback(): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
    return {
      success: false,
      error: 'WorkOS callback route is disabled when AUTH_PROVIDER=better-auth.',
    }
  }

  async sendPasswordResetEmail(): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error: 'Password reset is disabled when AUTH_PROVIDER=better-auth. Use your SSO identity provider.',
    }
  }

  async resetPassword(): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error: 'Password reset is disabled when AUTH_PROVIDER=better-auth. Use your SSO identity provider.',
    }
  }

  readEmailVerificationTicket(): EmailVerificationTicket {
    return null
  }

  async verifyEmail(): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error: 'Email verification is disabled when AUTH_PROVIDER=better-auth.',
    }
  }

  async resendVerificationEmail(): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error: 'Email verification is disabled when AUTH_PROVIDER=better-auth.',
    }
  }

  async refreshSessionFromRefreshToken(): Promise<AuthSession | null> {
    return null
  }

  async refreshSessionFromRefreshTokenResult(): Promise<RefreshSessionResult> {
    return { status: 'unsupported' }
  }
}

export const MOBILE_AUTH_REDIRECT_PATH = workosAuth.MOBILE_AUTH_REDIRECT_PATH
export const getBaseUrl = workosAuth.getBaseUrl
export const consumeAuthorizationState = workosAuth.consumeAuthorizationState
export const normalizeAuthRedirect = workosAuth.normalizeAuthRedirect
export const normalizeCodeChallenge = workosAuth.normalizeCodeChallenge

export function getWebAuthFlowProvider(): WebAuthFlowProvider {
  const config = getOverlayRuntimeConfigSync()
  const selected = config.providers.auth?.provider ?? config.auth.provider
  if (selected === 'better-auth') return new BetterAuthWebAuthFlowProvider()
  return new WorkOsWebAuthFlowProvider()
}

function forwardSetCookieHeaders(source: Response, target: NextResponse): void {
  const getSetCookie = (source.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const cookieHeaders = typeof getSetCookie === 'function'
    ? getSetCookie.call(source.headers)
    : source.headers.get('set-cookie')
      ? [source.headers.get('set-cookie') as string]
      : []
  for (const cookie of cookieHeaders) {
    target.headers.append('set-cookie', cookie)
  }
}

function betterAuthPasswordDisabled(): { success: boolean; error: string } {
  return {
    success: false,
    error: 'Email/password sign-in is disabled when AUTH_PROVIDER=better-auth. Use SSO.',
  }
}
