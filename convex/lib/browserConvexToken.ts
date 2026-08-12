import {
  BROWSER_CONVEX_TOKEN_AUD,
  BROWSER_CONVEX_TOKEN_ISS,
} from '../../src/shared/auth/browser-convex-token-constants'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

type BrowserConvexTokenClaims = {
  iss: string
  aud: string
  sub: string
  exp: number
  iat?: number
}

function getBrowserConvexTokenSecret(): string | null {
  return process.env.INTERNAL_API_SECRET?.trim() || null
}

function decodeBase64UrlToUint8Array(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = normalized.length % 4
  const b64 = pad === 0 ? normalized : normalized + '='.repeat(4 - pad)
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function decodeBase64UrlJson<T>(value: string): T | null {
  try {
    const bytes = decodeBase64UrlToUint8Array(value)
    return JSON.parse(textDecoder.decode(bytes)) as T
  } catch {
    return null
  }
}

/**
 * Verify short-lived HS256 browser→Convex tokens.
 * Safe inside Convex queries/mutations: uses only crypto.subtle (no fetch/JWKS).
 */
export async function verifyBrowserConvexAccessToken(
  accessToken: string,
): Promise<BrowserConvexTokenClaims | null> {
  if (!accessToken || typeof accessToken !== 'string') return null
  const secret = getBrowserConvexTokenSecret()
  if (!secret) return null

  const trimmed = accessToken.trim()
  const parts = trimmed.split('.')
  if (parts.length !== 3) return null

  const [headerSegment, payloadSegment, signatureSegment] = parts
  const header = decodeBase64UrlJson<{ alg?: string; typ?: string }>(headerSegment)
  const claims = decodeBase64UrlJson<BrowserConvexTokenClaims>(payloadSegment)
  if (!header || !claims) return null
  if (header.alg !== 'HS256') return null
  if (claims.iss !== BROWSER_CONVEX_TOKEN_ISS) return null
  if (claims.aud !== BROWSER_CONVEX_TOKEN_AUD) return null
  if (typeof claims.sub !== 'string' || !claims.sub.trim()) return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null

  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const signatureBytes = decodeBase64UrlToUint8Array(signatureSegment)
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes.buffer.slice(
      signatureBytes.byteOffset,
      signatureBytes.byteOffset + signatureBytes.byteLength,
    ) as ArrayBuffer,
    textEncoder.encode(`${headerSegment}.${payloadSegment}`),
  )
  return ok ? claims : null
}
