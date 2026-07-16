import 'server-only'

import type {
  AuthProvider,
  Session,
  TokenClaims,
  UserProfile,
} from '@overlay/app-core'

export interface OidcAuthProviderConfig {
  issuerUrl?: string
  clientId?: string
  clientSecret?: string
  audience?: string
}

type JwtHeader = {
  alg?: string
  kid?: string
}

type OidcTokenClaims = TokenClaims & {
  nbf?: number
}

type OidcDiscoveryDocument = {
  issuer?: string
  jwks_uri?: string
}

type OidcJwk = JsonWebKey & {
  kid?: string
  kty?: string
}

type CachedDiscovery = {
  expiresAt: number
  document: OidcDiscoveryDocument
}

type CachedJwks = {
  expiresAt: number
  keys: OidcJwk[]
}

const OIDC_CACHE_TTL_MS = 2 * 60 * 1000
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const discoveryCache = new Map<string, CachedDiscovery>()
const jwksCache = new Map<string, CachedJwks>()

export class OidcAuthProvider implements AuthProvider {
  readonly providerConfigSummary: {
    provider: 'oidc'
    issuerUrl?: string
    clientId?: string
    hasClientSecret: boolean
    audience?: string
  }

  constructor(private readonly config: OidcAuthProviderConfig = {}) {
    this.providerConfigSummary = {
      provider: 'oidc',
      ...(config.issuerUrl ? { issuerUrl: config.issuerUrl } : {}),
      ...(config.clientId ? { clientId: config.clientId } : {}),
      hasClientSecret: Boolean(config.clientSecret),
      ...(config.audience ? { audience: config.audience } : {}),
    }
  }

  async getSession(req: Request): Promise<Session | null> {
    const token = getBearerToken(req)
    if (!token) return null

    const claims = await this.verifyAccessToken(token)
    if (!claims) return null
    const profile = toUserProfile(claims)

    return {
      accessToken: token,
      expiresAt: claims.exp * 1000,
      user: {
        id: profile.id,
        email: profile.email ?? '',
        firstName: profile.firstName,
        lastName: profile.lastName,
        profilePictureUrl: profile.profilePictureUrl,
        emailVerified: profile.emailVerified,
      },
    }
  }

  async verifyAccessToken(token: string): Promise<TokenClaims | null> {
    if (!token || typeof token !== 'string') return null
    const issuer = this.normalizedIssuer()
    const audience = this.expectedAudience()
    if (!issuer || !audience) return null

    const trimmed = token.trim()
    const parts = trimmed.split('.')
    if (parts.length !== 3) return null

    const [headerSegment, payloadSegment, signatureSegment] = parts
    const header = decodeBase64UrlJson<JwtHeader>(headerSegment)
    const claims = decodeBase64UrlJson<OidcTokenClaims>(payloadSegment)
    if (!header || !claims) return null

    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) {
      return null
    }
    if (normalizeIssuer(claims.iss) !== issuer) return null
    if (typeof claims.sub !== 'string' || !claims.sub.trim()) return null
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null
    if (typeof claims.nbf === 'number' && claims.nbf * 1000 > Date.now()) return null
    if (!normalizeAudience(claims.aud).includes(audience)) return null

    const jwk = await this.findJwk(header.kid)
    if (!jwk) return null

    const verified = await verifyRs256Signature(
      `${headerSegment}.${payloadSegment}`,
      signatureSegment,
      jwk,
    ).catch((_error) => false)

    return verified ? claims : null
  }

  async getUserProfile(token: string): Promise<UserProfile | null> {
    const claims = await this.verifyAccessToken(token)
    return claims ? toUserProfile(claims) : null
  }

  async deleteUser(userId: string): Promise<void> {
    void userId
    throw new Error('OidcAuthProvider.deleteUser is not implemented; delete users in the upstream identity provider.')
  }

  private normalizedIssuer(): string | null {
    return typeof this.config.issuerUrl === 'string' && this.config.issuerUrl.trim()
      ? normalizeIssuer(this.config.issuerUrl)
      : null
  }

  private expectedAudience(): string | null {
    const value = this.config.audience?.trim() || this.config.clientId?.trim()
    return value || null
  }

  private async findJwk(kid: string): Promise<OidcJwk | null> {
    let keys = await this.fetchJwks(false)
    let jwk = keys.find((entry) => entry.kid === kid) ?? null
    if (jwk) return jwk

    keys = await this.fetchJwks(true)
    jwk = keys.find((entry) => entry.kid === kid) ?? null
    return jwk
  }

  private async fetchJwks(forceRefresh: boolean): Promise<OidcJwk[]> {
    const issuer = this.normalizedIssuer()
    if (!issuer) return []

    const now = Date.now()
    const cached = jwksCache.get(issuer)
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return cached.keys
    }

    const jwksUri = await this.resolveJwksUri(forceRefresh)
    if (!jwksUri) return []

    const response = await fetch(jwksUri)
    if (!response.ok) {
      throw new Error(`Failed to fetch OIDC JWKS: HTTP ${response.status}`)
    }
    const json = await response.json() as { keys?: OidcJwk[] }
    const keys = Array.isArray(json.keys) ? json.keys : []
    jwksCache.set(issuer, { expiresAt: now + OIDC_CACHE_TTL_MS, keys })
    return keys
  }

  private async resolveJwksUri(forceRefresh: boolean): Promise<string | null> {
    const issuer = this.normalizedIssuer()
    if (!issuer) return null

    const discovery = await this.fetchDiscovery(forceRefresh).catch((_error) => null)
    if (discovery?.jwks_uri) return discovery.jwks_uri

    return `${issuer}/.well-known/jwks.json`
  }

  private async fetchDiscovery(forceRefresh: boolean): Promise<OidcDiscoveryDocument | null> {
    const issuer = this.normalizedIssuer()
    if (!issuer) return null

    const now = Date.now()
    const cached = discoveryCache.get(issuer)
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return cached.document
    }

    const response = await fetch(`${issuer}/.well-known/openid-configuration`)
    if (!response.ok) {
      throw new Error(`Failed to fetch OIDC discovery: HTTP ${response.status}`)
    }
    const document = await response.json() as OidcDiscoveryDocument
    if (document.issuer && normalizeIssuer(document.issuer) !== issuer) {
      throw new Error('OIDC discovery issuer does not match configured issuer')
    }
    discoveryCache.set(issuer, { expiresAt: now + OIDC_CACHE_TTL_MS, document })
    return document
  }
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.toLowerCase().startsWith('bearer ')) return null
  const token = authHeader.slice(7).trim()
  return token || null
}

function normalizeIssuer(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
}

function normalizeAudience(aud: unknown): string[] {
  if (typeof aud === 'string') return [aud]
  if (Array.isArray(aud)) {
    return aud.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  }
  return []
}

function toBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = normalized.length % 4
  return pad === 0 ? normalized : normalized + '='.repeat(4 - pad)
}

function decodeBase64UrlToUint8Array(value: string): Uint8Array {
  const binary = atob(toBase64(value))
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
  } catch (_error) {
    return null
  }
}

async function verifyRs256Signature(
  signingInput: string,
  signatureSegment: string,
  jwk: OidcJwk,
): Promise<boolean> {
  if (jwk.kty !== 'RSA') return false

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const signatureBytes = decodeBase64UrlToUint8Array(signatureSegment)
  return await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signatureBytes.buffer.slice(
      signatureBytes.byteOffset,
      signatureBytes.byteOffset + signatureBytes.byteLength,
    ) as ArrayBuffer,
    textEncoder.encode(signingInput),
  )
}

function toUserProfile(claims: TokenClaims): UserProfile {
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    firstName:
      typeof claims.given_name === 'string'
        ? claims.given_name
        : typeof claims.firstName === 'string'
          ? claims.firstName
          : undefined,
    lastName:
      typeof claims.family_name === 'string'
        ? claims.family_name
        : typeof claims.lastName === 'string'
          ? claims.lastName
          : undefined,
    profilePictureUrl:
      typeof claims.picture === 'string'
        ? claims.picture
        : typeof claims.profilePictureUrl === 'string'
          ? claims.profilePictureUrl
          : undefined,
    emailVerified:
      typeof claims.email_verified === 'boolean'
        ? claims.email_verified
        : typeof claims.emailVerified === 'boolean'
          ? claims.emailVerified
          : undefined,
  }
}
