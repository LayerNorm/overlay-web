import { logAuthDebug, summarizeEnvResolutionForLog, summarizeJwtForLog } from './authDebug'

/** Canonical WorkOS issuer; tokens may use a trailing slash (e.g. AuthKit defaults). */
const WORKOS_ISSUER_PRIMARY = 'https://api.workos.com'
const JWKS_CACHE_TTL_MS = 2 * 60 * 1000
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

type WorkOSAccessTokenClaims = {
  iss: string
  sub: string
  aud?: string | string[]
  exp: number
  iat?: number
  [key: string]: unknown
}

type JwtHeader = {
  alg?: string
  kid?: string
  typ?: string
}

type CachedJwks = {
  expiresAt: number
  keys: WorkOsJwk[]
}

type WorkOsJwk = JsonWebKey & {
  kid?: string
  kty?: string
}

const jwksCache = new Map<string, CachedJwks>()

function getConfiguredBetterAuthIssuer(): string | null {
  const issuer = process.env.BETTER_AUTH_JWT_ISSUER?.trim()
  if (issuer) return normalizeJwtIssuer(issuer)

  const baseUrl = process.env.BETTER_AUTH_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()
  return baseUrl ? normalizeJwtIssuer(new URL(baseUrl).origin) : null
}

function getConfiguredBetterAuthAudience(): string | null {
  const audience = process.env.BETTER_AUTH_JWT_AUDIENCE?.trim()
  if (audience) return audience

  const baseUrl = process.env.BETTER_AUTH_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()
  return baseUrl ? new URL(baseUrl).origin : null
}

function getConfiguredBetterAuthJwksUrl(): string | null {
  const jwksUrl = process.env.BETTER_AUTH_JWKS_URL?.trim()
  if (jwksUrl) return jwksUrl

  const baseUrl = process.env.BETTER_AUTH_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!baseUrl) return null
  const basePath = process.env.BETTER_AUTH_BASE_PATH?.trim() || '/api/better-auth'
  return `${new URL(baseUrl).origin}${basePath.replace(/\/+$/, '')}/jwks`
}

function getConfiguredWorkOsClientIds(): string[] {
  return [...new Set(
    [process.env.WORKOS_CLIENT_ID, process.env.DEV_WORKOS_CLIENT_ID]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
  )]
}

function getConfiguredWorkOsApiKeys(): string[] {
  return [...new Set(
    [process.env.WORKOS_API_KEY, process.env.DEV_WORKOS_API_KEY]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
  )]
}

function normalizeAudience(aud: unknown): string[] {
  if (typeof aud === 'string') {
    return [aud]
  }
  if (Array.isArray(aud)) {
    return aud.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  }
  return []
}

function selectWorkOsClientId(aud: unknown): string | null {
  const audiences = normalizeAudience(aud)
  if (audiences.length === 0) return null
  const configuredClientIds = getConfiguredWorkOsClientIds()
  if (configuredClientIds.length === 0) return null
  return configuredClientIds.find((clientId) => audiences.includes(clientId)) ?? null
}

/** Resolve JWKS client id: match aud to configured IDs, or single configured ID only if aud is absent. */
function selectWorkOsClientIdForVerification(aud: unknown): string | null {
  const audiences = normalizeAudience(aud)
  if (audiences.length > 0) {
    return selectWorkOsClientId(aud)
  }
  const configured = getConfiguredWorkOsClientIds()
  if (configured.length !== 1) return null
  return configured[0] ?? null
}

function normalizeJwtIssuer(iss: string): string {
  return iss.trim().replace(/\/+$/, '')
}

let trustedJwtIssuersCache: Set<string> | null = null

function getTrustedJwtIssuers(): Set<string> {
  if (trustedJwtIssuersCache) return trustedJwtIssuersCache
  const out = new Set<string>([normalizeJwtIssuer(WORKOS_ISSUER_PRIMARY)])
  for (const clientId of getConfiguredWorkOsClientIds()) {
    out.add(normalizeJwtIssuer(`${WORKOS_ISSUER_PRIMARY}/user_management/${clientId}`))
  }
  const extra = process.env.WORKOS_JWT_ISSUERS?.split(',') ?? []
  for (const raw of extra) {
    const trimmed = raw.trim()
    if (trimmed) out.add(normalizeJwtIssuer(trimmed))
  }
  trustedJwtIssuersCache = out
  return out
}

function isTrustedWorkOsIssuer(iss: unknown): boolean {
  if (typeof iss !== 'string' || !iss.trim()) return false
  return getTrustedJwtIssuers().has(normalizeJwtIssuer(iss))
}

function toBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = normalized.length % 4
  if (pad === 0) return normalized
  return normalized + '='.repeat(4 - pad)
}

function decodeBase64UrlToUint8Array(value: string): Uint8Array {
  const b64 = toBase64(value)
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

async function fetchJwks(clientId: string, forceRefresh = false): Promise<WorkOsJwk[]> {
  const now = Date.now()
  const cached = jwksCache.get(clientId)
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.keys
  }

  const apiKey = process.env.WORKOS_API_KEY || process.env.DEV_WORKOS_API_KEY
  const jwksBase = (process.env.WORKOS_JWKS_BASE_URL?.trim() || 'https://api.workos.com').replace(/\/$/, '')
  const response = await fetch(`${jwksBase}/sso/jwks/${clientId}`, {
    headers: apiKey
      ? { Authorization: `Bearer ${apiKey}` }
      : undefined,
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch WorkOS JWKS: HTTP ${response.status}`)
  }

  const json = await response.json() as { keys?: WorkOsJwk[] }
  const keys = Array.isArray(json.keys) ? json.keys : []
  jwksCache.set(clientId, {
    expiresAt: now + JWKS_CACHE_TTL_MS,
    keys,
  })
  return keys
}

async function fetchJwksFromUrl(cacheKey: string, url: string, forceRefresh = false): Promise<WorkOsJwk[]> {
  const now = Date.now()
  const cached = jwksCache.get(cacheKey)
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.keys
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: HTTP ${response.status}`)
  }

  const json = await response.json() as { keys?: WorkOsJwk[] }
  const keys = Array.isArray(json.keys) ? json.keys : []
  jwksCache.set(cacheKey, {
    expiresAt: now + JWKS_CACHE_TTL_MS,
    keys,
  })
  return keys
}

async function findJwk(clientId: string, kid: string): Promise<WorkOsJwk | null> {
  let keys = await fetchJwks(clientId)
  let jwk =
    keys.find((entry) => typeof entry.kid === 'string' && entry.kid === kid) ?? null
  if (jwk) return jwk

  keys = await fetchJwks(clientId, true)
  jwk = keys.find((entry) => typeof entry.kid === 'string' && entry.kid === kid) ?? null
  return jwk
}

async function verifyTokenAgainstClientId(
  clientId: string,
  kid: string,
  signingInput: string,
  signatureSegment: string,
): Promise<boolean> {
  const jwk = await findJwk(clientId, kid)
  if (!jwk) return false

  return await verifyRs256Signature(signingInput, signatureSegment, jwk)
}

async function verifyTokenAgainstAnyConfiguredClientId(
  kid: string,
  signingInput: string,
  signatureSegment: string,
): Promise<boolean> {
  const configuredClientIds = getConfiguredWorkOsClientIds()
  if (configuredClientIds.length === 0) return false

  for (const clientId of configuredClientIds) {
    if (await verifyTokenAgainstClientId(clientId, kid, signingInput, signatureSegment)) {
      return true
    }
  }

  return false
}

async function verifyBetterAuthToken(
  header: JwtHeader,
  claims: WorkOSAccessTokenClaims,
  signingInput: string,
  signatureSegment: string,
): Promise<WorkOSAccessTokenClaims | null> {
  const issuer = getConfiguredBetterAuthIssuer()
  const audience = getConfiguredBetterAuthAudience()
  const jwksUrl = getConfiguredBetterAuthJwksUrl()

  if (!issuer || !audience || !jwksUrl) return null
  if (normalizeJwtIssuer(claims.iss) !== issuer) return null
  if (!normalizeAudience(claims.aud).includes(audience)) return null
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) return null

  let jwk: WorkOsJwk | null = null
  try {
    let keys = await fetchJwksFromUrl(`better-auth:${jwksUrl}`, jwksUrl)
    jwk = keys.find((entry) => typeof entry.kid === 'string' && entry.kid === header.kid) ?? null
    if (!jwk) {
      keys = await fetchJwksFromUrl(`better-auth:${jwksUrl}`, jwksUrl, true)
      jwk = keys.find((entry) => typeof entry.kid === 'string' && entry.kid === header.kid) ?? null
    }
  } catch (error) {
    logAuthDebug('Better Auth JWKS fetch failed', {
      jwksUrl,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
  if (!jwk) return null

  const verified = await verifyRs256Signature(signingInput, signatureSegment, jwk)
  return verified ? claims : null
}

async function verifyRs256Signature(
  signingInput: string,
  signatureSegment: string,
  jwk: WorkOsJwk,
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
    new TextEncoder().encode(signingInput),
  )
}

export async function getVerifiedAccessTokenClaims(
  accessToken: string,
): Promise<WorkOSAccessTokenClaims | null> {
  if (!accessToken || typeof accessToken !== 'string') return null

  const trimmed = accessToken.trim()
  const parts = trimmed.split('.')
  if (parts.length !== 3) return null

  const [headerSegment, payloadSegment, signatureSegment] = parts
  const header = decodeBase64UrlJson<JwtHeader>(headerSegment)
  const claims = decodeBase64UrlJson<WorkOSAccessTokenClaims>(payloadSegment)
  if (!header || !claims) return null

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) {
    return null
  }
  if (typeof claims.sub !== 'string' || !claims.sub.trim()) return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null

  const signingInput = `${headerSegment}.${payloadSegment}`

  if (!isTrustedWorkOsIssuer(claims.iss)) {
    return verifyBetterAuthToken(header, claims, signingInput, signatureSegment)
  }

  const audiences = normalizeAudience(claims.aud)

  let verified = false
  if (audiences.length > 0) {
    const clientId = selectWorkOsClientId(claims.aud)
    if (!clientId) return null
    verified = await verifyTokenAgainstClientId(clientId, header.kid, signingInput, signatureSegment)
  } else {
    const clientId = selectWorkOsClientIdForVerification(claims.aud)
    verified = clientId
      ? await verifyTokenAgainstClientId(clientId, header.kid, signingInput, signatureSegment)
      : await verifyTokenAgainstAnyConfiguredClientId(header.kid, signingInput, signatureSegment)
  }

  return verified ? claims : null
}

export async function debugAccessTokenVerification(
  accessToken: string,
  userId?: string,
): Promise<Record<string, unknown>> {
  const tokenSummary = summarizeJwtForLog(accessToken)
  const diagnostics: Record<string, unknown> = {
    env: {
      ...summarizeEnvResolutionForLog(),
      configuredClientIds: getConfiguredWorkOsClientIds(),
      configuredApiKeyCount: getConfiguredWorkOsApiKeys().length,
    },
    token: tokenSummary,
    expectedUserId: userId ?? null,
  }

  if (!accessToken || typeof accessToken !== 'string') {
    return { ...diagnostics, verified: false, reason: 'missing_access_token' }
  }

  const trimmed = accessToken.trim()
  const parts = trimmed.split('.')
  if (parts.length !== 3) {
    return { ...diagnostics, verified: false, reason: 'invalid_token_format' }
  }

  const [headerSegment, payloadSegment, signatureSegment] = parts
  const header = decodeBase64UrlJson<JwtHeader>(headerSegment)
  const claims = decodeBase64UrlJson<WorkOSAccessTokenClaims>(payloadSegment)
  if (!header || !claims) {
    return { ...diagnostics, verified: false, reason: 'invalid_json_segments' }
  }

  const audiences = normalizeAudience(claims.aud)
  const configuredClientIds = getConfiguredWorkOsClientIds()
  const selectedClientId = audiences.length > 0
    ? selectWorkOsClientId(claims.aud)
    : selectWorkOsClientIdForVerification(claims.aud)
  const candidateClientIds = selectedClientId
    ? [selectedClientId]
    : audiences.length > 0
      ? configuredClientIds
      : configuredClientIds

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) {
    return {
      ...diagnostics,
      verified: false,
      reason: 'invalid_header',
      header,
    }
  }

  if (!isTrustedWorkOsIssuer(claims.iss)) {
    return {
      ...diagnostics,
      verified: false,
      reason: 'untrusted_issuer',
      issuer: claims.iss,
      trustedIssuers: [...getTrustedJwtIssuers()],
    }
  }

  if (typeof claims.sub !== 'string' || !claims.sub.trim()) {
    return {
      ...diagnostics,
      verified: false,
      reason: 'missing_subject',
    }
  }

  if (typeof claims.exp !== 'number') {
    return {
      ...diagnostics,
      verified: false,
      reason: 'missing_expiration',
    }
  }

  if (claims.exp * 1000 <= Date.now()) {
    return {
      ...diagnostics,
      verified: false,
      reason: 'expired_token',
    }
  }

  if (audiences.length > 0 && !selectedClientId) {
    return {
      ...diagnostics,
      verified: false,
      reason: 'audience_mismatch',
      audiences,
      configuredClientIds,
    }
  }

  const signingInput = `${headerSegment}.${payloadSegment}`
  const attempts: Array<Record<string, unknown>> = []

  for (const clientId of candidateClientIds) {
    try {
      const jwk = await findJwk(clientId, header.kid)
      if (!jwk) {
        attempts.push({
          clientId,
          kid: header.kid,
          foundJwk: false,
          signatureVerified: false,
        })
        continue
      }

      const signatureVerified = await verifyRs256Signature(signingInput, signatureSegment, jwk)
      attempts.push({
        clientId,
        kid: header.kid,
        foundJwk: true,
        jwkKid: typeof jwk.kid === 'string' ? jwk.kid : null,
        signatureVerified,
      })
    } catch (error) {
      attempts.push({
        clientId,
        kid: header.kid,
        foundJwk: false,
        signatureVerified: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const verified = attempts.some((attempt) => attempt.signatureVerified === true)
  const subjectMatches = userId ? claims.sub === userId : null

  return {
    ...diagnostics,
    verified,
    reason: verified ? (subjectMatches === false ? 'subject_mismatch' : 'verified') : 'signature_or_client_mismatch',
    audiences,
    selectedClientId,
    candidateClientIds,
    attempts,
    subjectMatches,
  }
}

export async function validateAccessToken(accessToken: string): Promise<boolean> {
  return (await getVerifiedAccessTokenClaims(accessToken)) !== null
}

export async function requireAccessToken(
  accessToken: string,
  userId?: string,
): Promise<WorkOSAccessTokenClaims> {
  const claims = await getVerifiedAccessTokenClaims(accessToken)
  if (!claims) {
    logAuthDebug('requireAccessToken rejected token', await debugAccessTokenVerification(accessToken, userId))
    throw new Error('Unauthorized')
  }
  if (userId && claims.sub !== userId) {
    logAuthDebug('requireAccessToken subject mismatch', {
      expectedUserId: userId,
      actualSubject: claims.sub,
      token: summarizeJwtForLog(accessToken),
    })
    throw new Error('Unauthorized')
  }
  return claims
}

export function constantTimeEqualStrings(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false
  }

  const leftBytes = textEncoder.encode(left)
  const rightBytes = textEncoder.encode(right)
  const maxLength = Math.max(leftBytes.length, rightBytes.length)

  let diff = leftBytes.length ^ rightBytes.length
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }

  return diff === 0
}

export function validateServerSecret(secret: string | undefined): boolean {
  const expected = process.env.INTERNAL_API_SECRET?.trim()
  const provided = secret?.trim()
  if (!expected || !provided) return false

  return constantTimeEqualStrings(expected, provided)
}

export function validateProviderKeysSecret(secret: string | undefined): boolean {
  const expected = process.env.PROVIDER_KEYS_SECRET?.trim()
  const provided = secret?.trim()
  if (!expected || !provided) return false

  return constantTimeEqualStrings(expected, provided)
}

export function requireServerSecret(secret: string | undefined): void {
  if (!validateServerSecret(secret)) {
    throw new Error('Unauthorized')
  }
}

export function requireProviderKeysSecret(secret: string | undefined): void {
  if (!validateProviderKeysSecret(secret)) {
    throw new Error('Unauthorized')
  }
}
