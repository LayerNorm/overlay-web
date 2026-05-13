import { getExtensionStorage } from './storage'
import { assertTrustedOverlayBaseUrl, normalizeTrustedOverlayBaseUrl } from './trusted-origins'

const HANDOFF_VERIFIER_KEY = 'overlay.extension.handoffVerifier'

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function randomVerifier(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** S256 code challenge (same shape as desktop app + Convex session transfer). */
export async function codeChallengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier.trim()))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function storeHandoffVerifier(verifier: string): Promise<void> {
  await chrome.storage.session.set({ [HANDOFF_VERIFIER_KEY]: verifier })
}

export async function takeHandoffVerifier(): Promise<string | null> {
  const raw = await chrome.storage.session.get(HANDOFF_VERIFIER_KEY)
  await chrome.storage.session.remove(HANDOFF_VERIFIER_KEY)
  const v = raw[HANDOFF_VERIFIER_KEY]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Opens branded sign-in; redirect lands on /account with PKCE challenge so the
 * signed-in page can mint a short-lived transfer token for this extension.
 */
export function buildExtensionSignInUrl(args: { baseUrl: string; extensionId: string; codeChallenge: string }): string {
  const origin = assertTrustedOverlayBaseUrl(args.baseUrl)
  const account = new URL('/account', origin)
  account.searchParams.set('desktop_code_challenge', args.codeChallenge)
  account.searchParams.set('extension_handoff', '1')
  account.searchParams.set('chrome_extension_id', args.extensionId)

  const signIn = new URL('/auth/sign-in', origin)
  signIn.searchParams.set('redirect', `${account.pathname}${account.search}`)
  return signIn.toString()
}

export async function prepareExtensionSignInTabUrl(): Promise<{ url: string }> {
  const { preferences } = await getExtensionStorage()
  const baseUrl = normalizeTrustedOverlayBaseUrl(preferences?.baseUrl)
  const verifier = randomVerifier()
  await storeHandoffVerifier(verifier)
  const challenge = await codeChallengeFromVerifier(verifier)
  const extensionId = chrome.runtime.id
  const url = buildExtensionSignInUrl({ baseUrl, extensionId, codeChallenge: challenge })
  return { url }
}

export interface SessionTransferPayload {
  userId: string
  email: string
  firstName?: string
  lastName?: string
  accessToken: string
  refreshToken?: string
}

export async function fetchSessionTransferPayload(args: {
  baseUrl: string
  token: string
  codeVerifier: string
}): Promise<SessionTransferPayload> {
  const baseUrl = assertTrustedOverlayBaseUrl(args.baseUrl)
  const url = new URL(joinUrl(baseUrl, '/api/auth/desktop-link'))
  url.searchParams.set('token', args.token)

  const response = await fetch(url.toString(), {
    headers: {
      'x-overlay-code-verifier': args.codeVerifier,
    },
  })

  const payload = await response.json().catch(() => ({})) as {
    error?: string
    userId?: string
    email?: string
    firstName?: string
    lastName?: string
    accessToken?: string
    refreshToken?: string
  }

  if (!response.ok || !payload.accessToken?.trim() || !payload.userId?.trim()) {
    throw new Error(payload.error || 'Could not complete extension sign-in. Try again from Connect.')
  }

  return {
    userId: payload.userId.trim(),
    email: typeof payload.email === 'string' ? payload.email : '',
    firstName: payload.firstName,
    lastName: payload.lastName,
    accessToken: payload.accessToken.trim(),
    refreshToken: payload.refreshToken?.trim(),
  }
}
