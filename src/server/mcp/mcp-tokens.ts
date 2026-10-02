import 'server-only'

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed values for Overlay's MCP server for other AI apps: client ids, authorization
 * codes, access and refresh tokens, and personal tokens. All are stateless HMAC
 * envelopes. Anything that must be revocable or single-use carries the id of a
 * `mcpGrants` row and is checked against it on use, so the signature proves
 * "Overlay issued this" and the row decides "it still counts".
 *
 * The kind is part of what is signed, so a refresh token cannot be presented as an
 * access token, or a code as either.
 */

export type McpSealedKind = 'client' | 'code' | 'access' | 'refresh' | 'personal'

const PREFIX: Record<McpSealedKind, string> = {
  client: 'ovclient_',
  code: 'ovcode_',
  access: 'ovmcu_a_',
  refresh: 'ovmcu_r_',
  personal: 'ovmcu_p_',
}

export const MCP_ACCESS_TOKEN_TTL_MS = 60 * 60_000
export const MCP_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000
export const MCP_CODE_TTL_MS = 60_000

function signingSecret(): string | null {
  return process.env.OVERLAY_MCP_OAUTH_SECRET?.trim()
    || process.env.INTERNAL_SERVICE_AUTH_SECRET?.trim()
    || process.env.INTERNAL_API_SECRET?.trim()
    || null
}

function signature(kind: McpSealedKind, payloadB64: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`overlay-mcp-oauth:v1.${kind}.${payloadB64}`).digest()
}

/** `null` when there is no signing secret, so callers fail closed instead of issuing unsigned values. */
export function sealMcpValue(kind: McpSealedKind, payload: Record<string, unknown>, ttlMs?: number): string | null {
  const secret = signingSecret()
  if (!secret) return null
  const body = { ...payload, ...(ttlMs ? { exp: Date.now() + ttlMs } : {}) }
  const payloadB64 = Buffer.from(JSON.stringify(body)).toString('base64url')
  return `${PREFIX[kind]}${payloadB64}.${signature(kind, payloadB64, secret).toString('base64url')}`
}

export function openMcpValue(kind: McpSealedKind, value: string | null | undefined): Record<string, unknown> | null {
  const secret = signingSecret()
  if (!secret || !value?.startsWith(PREFIX[kind])) return null
  const [payloadB64, signatureB64] = value.slice(PREFIX[kind].length).split('.')
  if (!payloadB64 || !signatureB64) return null
  const given = Buffer.from(signatureB64, 'base64url')
  const expected = signature(kind, payloadB64, secret)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof parsed.exp === 'number' && parsed.exp <= Date.now()) return null
    return parsed
  } catch (_error) {
    return null
  }
}

/** The value looks like one of Overlay's MCP access credentials (used to pick a 401 vs a malformed-request response). */
export function isMcpBearerCandidate(value: string | null | undefined): boolean {
  return Boolean(value && (value.startsWith(PREFIX.access) || value.startsWith(PREFIX.personal)))
}

/** PKCE S256: the verifier the client presents must hash to the challenge it sent when authorizing. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (verifier.length < 43 || verifier.length > 128 || !/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'))
  const expected = Buffer.from(challenge)
  return computed.length === expected.length && timingSafeEqual(computed, expected)
}
