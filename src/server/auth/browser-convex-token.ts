import 'server-only'

import {
  BROWSER_CONVEX_TOKEN_AUD,
  BROWSER_CONVEX_TOKEN_ISS,
  BROWSER_CONVEX_TOKEN_TTL_MS,
} from '@/shared/auth/browser-convex-token-constants'

const textEncoder = new TextEncoder()

function getBrowserConvexTokenSecret(): string {
  const secret = process.env.INTERNAL_API_SECRET?.trim()
  if (!secret) {
    throw new Error('INTERNAL_API_SECRET is required to mint browser Convex tokens')
  }
  return secret
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function toBase64UrlJson(value: unknown): string {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify(value)))
}

/**
 * Mint a short-lived HS256 JWT the browser can pass to Convex queries.
 * Convex queries cannot call fetch() for WorkOS JWKS, so browser subscriptions
 * must use a secret already present on both the Next app and Convex deployment.
 */
export async function mintBrowserConvexAccessToken(args: {
  userId: string
  ttlMs?: number
}): Promise<string> {
  const userId = args.userId.trim()
  if (!userId) throw new Error('userId is required')

  const nowSec = Math.floor(Date.now() / 1000)
  const ttlMs = Math.max(60_000, args.ttlMs ?? BROWSER_CONVEX_TOKEN_TTL_MS)
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    iss: BROWSER_CONVEX_TOKEN_ISS,
    aud: BROWSER_CONVEX_TOKEN_AUD,
    sub: userId,
    iat: nowSec,
    exp: nowSec + Math.floor(ttlMs / 1000),
  }
  const signingInput = `${toBase64UrlJson(header)}.${toBase64UrlJson(payload)}`
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(getBrowserConvexTokenSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(signingInput))
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`
}
