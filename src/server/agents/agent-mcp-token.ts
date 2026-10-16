import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

/**
 * Bearer token a connected agent's Agent Host hands to its ACP runtime as the
 * `Authorization` header of the Overlay MCP server (`/api/agent-mcp`).
 *
 * It is minted per remote turn and carries only that turn's scope: who
 * summoned the agent (tools act as that person — the delegate model), the
 * agent and its grant, and the run it belongs to. The endpoint also requires
 * the run's remote session to still be live, so the token stops working when
 * the turn ends even before it expires.
 */

const TOKEN_VERSION = 1
const MAX_LATEST_TEXT_CHARS = 2_000
export const AGENT_MCP_TOKEN_SLACK_MS = 5 * 60 * 1_000

const identity = z.string().min(1).max(2048)
const claimsSchema = z.object({
  userId: identity, workspaceId: identity, agentId: identity, agentPrincipalId: identity,
  conversationId: identity, environmentId: identity, runId: identity, turnId: identity,
  invocationNonce: identity, modelId: identity, memoryEnabled: z.boolean().default(true),
  grant: z.object({ allowedToolIds: z.array(identity), isDefaultMaster: z.boolean() }),
  latestUserText: z.string().max(MAX_LATEST_TEXT_CHARS).optional(),
  sessionId: identity.optional(),
  approvalBridge: z.literal(true).optional(),
  execution: z.object({ attemptId: identity, generation: z.number().int().nonnegative() }).optional(),
  expiresAt: z.number().int().positive(),
}).refine(claims => !claims.execution || claims.execution.attemptId === claims.sessionId)
export type AgentMcpTokenClaims = z.infer<typeof claimsSchema>

function signingSecret(): string | null {
  return process.env.OVERLAY_AGENT_MCP_SECRET?.trim()
    || process.env.INTERNAL_SERVICE_AUTH_SECRET?.trim()
    || process.env.INTERNAL_API_SECRET?.trim()
    || null
}

function signatureFor(payloadB64: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`overlay-agent-mcp:v${TOKEN_VERSION}.${payloadB64}`).digest()
}

export function mintAgentMcpToken(claims: Omit<AgentMcpTokenClaims, 'expiresAt'> & { ttlMs: number; expiresAt?: number }): string | null {
  const secret = signingSecret()
  if (!secret || !Number.isFinite(claims.ttlMs) || claims.ttlMs <= 0) return null
  const { ttlMs, latestUserText, expiresAt, ...rest } = claims
  const parsed = claimsSchema.safeParse({
    ...rest,
    ...(latestUserText ? { latestUserText: latestUserText.slice(0, MAX_LATEST_TEXT_CHARS) } : {}),
    expiresAt: Math.min(Date.now() + Math.max(1, Math.floor(ttlMs)), expiresAt ?? Infinity),
  })
  if (!parsed.success || parsed.data.expiresAt <= Date.now()) return null
  const payload = { v: TOKEN_VERSION, ...parsed.data }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `ovmcp_${payloadB64}.${signatureFor(payloadB64, secret).toString('base64url')}`
}

export function verifyAgentMcpToken(token: string | null | undefined): AgentMcpTokenClaims | null {
  const secret = signingSecret()
  if (!secret || !token?.startsWith('ovmcp_') || token.length > 65536) return null
  const pieces = token.slice('ovmcp_'.length).split('.')
  if (pieces.length !== 2 || !pieces.every(piece => /^[A-Za-z0-9_-]+$/.test(piece))) return null
  const [payloadB64, signatureB64] = pieces
  if (!payloadB64 || !signatureB64) return null
  const signature = Buffer.from(signatureB64, 'base64url')
  if (signature.toString('base64url') !== signatureB64 || Buffer.from(payloadB64, 'base64url').toString('base64url') !== payloadB64) return null
  const expected = signatureFor(payloadB64, secret)
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null
  try {
    const value: unknown = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    const parsed = z.object({ v: z.literal(TOKEN_VERSION) }).passthrough().safeParse(value)
    if (!parsed.success) return null
    const claims = claimsSchema.safeParse(parsed.data)
    return claims.success && claims.data.expiresAt > Date.now() ? claims.data : null
  } catch (_error) {
    return null
  }
}
