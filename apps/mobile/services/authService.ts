import * as SecureStore from 'expo-secure-store'
import { AUTH_BASE_URL } from './appConfig'
import { convexClient } from './convexClient'

const AUTH_STORAGE_KEY = 'overlay-auth-session'

export interface AuthUser {
  id: string
  email: string
  firstName?: string
  lastName?: string
  profilePictureUrl?: string
  emailVerified?: boolean
}

export interface AuthSession {
  accessToken: string
  refreshToken: string
  user: AuthUser
  expiresAt?: number
}

export interface AuthProfile {
  profile: {
    userId: string
    email: string
    name?: string
    firstName?: string
    lastName?: string
    profilePictureUrl?: string
    lastLoginAt?: number
  }
  subscription: {
    tier: 'free' | 'pro' | 'max'
    status: 'active' | 'canceled' | 'past_due' | 'trialing'
    stripeCustomerId?: string
    stripeSubscriptionId?: string
    currentPeriodStart?: number
    currentPeriodEnd?: number
  }
  usage: {
    creditsUsed: number
    creditsTotal: number
    inputTokens: number
    outputTokens: number
    cachedInputTokens: number
  }
  dailyUsage: {
    askCount: number
    writeCount: number
    agentCount: number
    transcriptionSeconds: number
    voiceChatCount: number
    noteBrowserCount: number
    browserSearchCount: number
  }
}

export interface AuthEntitlements {
  tier: 'free' | 'pro' | 'max'
  creditsUsed: number
  creditsTotal: number
  dailyUsage: {
    ask: number
    write: number
    agent: number
  }
  dailyLimits: {
    ask: number
    write: number
    agent: number
  }
  transcriptionSecondsUsed: number
  transcriptionSecondsLimit: number
  localTranscriptionEnabled: boolean
  resetAt: string
  billingPeriodEnd: string
  lastSyncedAt: number
}

interface TransferResponse {
  userId: string
  email: string
  firstName?: string
  lastName?: string
  profilePictureUrl?: string
  accessToken: string
  refreshToken: string
}

interface NativeRefreshResponse {
  success: boolean
  session?: AuthSession
  error?: string
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  try {
    const stored = await SecureStore.getItemAsync(AUTH_STORAGE_KEY)
    if (!stored) {
      return null
    }

    return JSON.parse(stored) as AuthSession
  } catch {
    return null
  }
}

export async function saveAuthSession(session: AuthSession): Promise<void> {
  await SecureStore.setItemAsync(AUTH_STORAGE_KEY, JSON.stringify(session))
}

export async function clearAuthSession(): Promise<void> {
  await SecureStore.deleteItemAsync(AUTH_STORAGE_KEY)
}

export function buildCustomAuthUrl(
  mode: 'sign-in' | 'sign-up',
  options: { forceLogin?: boolean } = {}
): string {
  const authUrl = new URL(`${AUTH_BASE_URL}${mode === 'sign-up' ? '/auth/sign-up' : '/auth/sign-in'}`)
  authUrl.searchParams.set('redirect', '/auth/mobile-complete')

  if (options.forceLogin && mode === 'sign-in') {
    authUrl.searchParams.set('force', 'true')
  }

  return authUrl.toString()
}

export function getAccountUrl(): string {
  return `${AUTH_BASE_URL}/account`
}

export function extractTransferToken(url: string): string | null {
  try {
    const parsedUrl = new URL(url)
    const path = parsedUrl.hostname || parsedUrl.pathname.replace(/^\/+/, '')

    if (path === 'auth' && parsedUrl.pathname.includes('/transfer')) {
      return parsedUrl.searchParams.get('token')
    }

    return null
  } catch {
    return null
  }
}

export async function consumeTransferToken(token: string): Promise<AuthSession> {
  const response = await fetch(`${AUTH_BASE_URL}/api/auth/desktop-link?token=${encodeURIComponent(token)}`)

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Session transfer failed: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as TransferResponse

  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    user: {
      id: data.userId,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      profilePictureUrl: data.profilePictureUrl
    }
  }
}

export async function refreshAuthSession(session: AuthSession): Promise<AuthSession> {
  const response = await fetch(`${AUTH_BASE_URL}/api/auth/native/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      refreshToken: session.refreshToken,
      user: session.user
    })
  })

  const data = (await response.json().catch(() => ({}))) as NativeRefreshResponse

  if (!response.ok || !data.session) {
    throw new Error(data.error || `Session refresh failed with status ${response.status}`)
  }

  return data.session
}

export async function syncUserProfile(session: AuthSession): Promise<void> {
  await convexClient.mutation('users:syncUserProfile', {
    accessToken: session.accessToken,
    userId: session.user.id,
    email: session.user.email,
    firstName: session.user.firstName,
    lastName: session.user.lastName,
    profilePictureUrl: session.user.profilePictureUrl
  })
}

export async function getUserProfile(session: AuthSession): Promise<AuthProfile | null> {
  return convexClient.query<AuthProfile>('users:getUserProfile', {
    accessToken: session.accessToken,
    userId: session.user.id
  })
}

export async function getEntitlements(session: AuthSession): Promise<AuthEntitlements | null> {
  return convexClient.query<AuthEntitlements>('usage:getEntitlements', {
    accessToken: session.accessToken,
    userId: session.user.id
  })
}
