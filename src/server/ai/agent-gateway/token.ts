import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Scoped bearer tokens for sub-agent CLIs running inside Overlay machines.
 *
 * The token is what an in-box CLI (claude, codex, opencode, …) presents to
 * `/api/agent-gateway/<provider>` instead of a real provider key. It carries
 * only the billing subject — workspace, agent, creator — and a short expiry.
 * It never authorizes anything beyond model proxying for the recorded scope,
 * so a leaked token inside a sandbox expires quickly and spends against the
 * agent's own budget cap.
 */

const TOKEN_VERSION = 1
export const AGENT_GATEWAY_TOKEN_TTL_MS = 15 * 60 * 1000

export type AgentGatewayTokenClaims = {
  userId: string
  workspaceId: string
  /** Present when the machine is bound to an agent (the billing subject). */
  agentId?: string
  expiresAt: number
}

function signingSecret(): string | null {
  return process.env.OVERLAY_AGENT_GATEWAY_SECRET?.trim()
    || process.env.INTERNAL_API_SECRET?.trim()
    || null
}

function encode(bytes: Buffer | string): string {
  return Buffer.from(bytes).toString('base64url')
}

function decode(value: string): Buffer | null {
  try {
    return Buffer.from(value, 'base64url')
  } catch (_error) {
    return null
  }
}

function signatureFor(payloadB64: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`overlay-agent-gateway:v${TOKEN_VERSION}.${payloadB64}`).digest()
}

export function mintAgentGatewayToken(claims: {
  userId: string
  workspaceId: string
  agentId?: string
  ttlMs?: number
}): string | null {
  const secret = signingSecret()
  if (!secret) return null
  const payload = {
    v: TOKEN_VERSION,
    uid: claims.userId,
    wid: claims.workspaceId,
    ...(claims.agentId ? { aid: claims.agentId } : {}),
    exp: Date.now() + Math.max(1_000, claims.ttlMs ?? AGENT_GATEWAY_TOKEN_TTL_MS),
  }
  const payloadB64 = encode(JSON.stringify(payload))
  return `${payloadB64}.${encode(signatureFor(payloadB64, secret))}`
}

export function verifyAgentGatewayToken(token: string): AgentGatewayTokenClaims | null {
  const secret = signingSecret()
  if (!secret) return null
  const [payloadB64, signatureB64] = token.split('.')
  if (!payloadB64 || !signatureB64) return null
  const signature = decode(signatureB64)
  const expected = signatureFor(payloadB64, secret)
  if (!signature || signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    return null
  }
  const raw = decode(payloadB64)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
    if (parsed.v !== TOKEN_VERSION
      || typeof parsed.uid !== 'string'
      || typeof parsed.wid !== 'string'
      || typeof parsed.exp !== 'number'
      || parsed.exp <= Date.now()) return null
    return {
      userId: parsed.uid,
      workspaceId: parsed.wid,
      agentId: typeof parsed.aid === 'string' ? parsed.aid : undefined,
      expiresAt: parsed.exp,
    }
  } catch (_error) {
    return null
  }
}
