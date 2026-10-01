import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AgentMcpToolGrant } from './agent-mcp-tools'

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

export type AgentMcpTokenClaims = {
  userId: string
  workspaceId: string
  agentId: string
  agentPrincipalId: string
  conversationId: string
  environmentId: string
  runId: string
  turnId: string
  invocationNonce: string
  modelId: string
  memoryEnabled: boolean
  grant: AgentMcpToolGrant
  /** The summoning message, which gates mutation tools like a native turn. */
  latestUserText?: string
  expiresAt: number
}

function signingSecret(): string | null {
  return process.env.OVERLAY_AGENT_MCP_SECRET?.trim()
    || process.env.INTERNAL_SERVICE_AUTH_SECRET?.trim()
    || process.env.INTERNAL_API_SECRET?.trim()
    || null
}

function signatureFor(payloadB64: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`overlay-agent-mcp:v${TOKEN_VERSION}.${payloadB64}`).digest()
}

export function mintAgentMcpToken(claims: Omit<AgentMcpTokenClaims, 'expiresAt'> & { ttlMs: number }): string | null {
  const secret = signingSecret()
  if (!secret) return null
  const { ttlMs, latestUserText, ...rest } = claims
  const payload = {
    v: TOKEN_VERSION,
    ...rest,
    ...(latestUserText ? { latestUserText: latestUserText.slice(0, MAX_LATEST_TEXT_CHARS) } : {}),
    expiresAt: Date.now() + Math.max(1_000, ttlMs),
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `ovmcp_${payloadB64}.${signatureFor(payloadB64, secret).toString('base64url')}`
}

const STRING_CLAIMS = [
  'userId', 'workspaceId', 'agentId', 'agentPrincipalId', 'conversationId',
  'environmentId', 'runId', 'turnId', 'invocationNonce', 'modelId',
] as const

export function verifyAgentMcpToken(token: string | null | undefined): AgentMcpTokenClaims | null {
  const secret = signingSecret()
  if (!secret || !token?.startsWith('ovmcp_')) return null
  const [payloadB64, signatureB64] = token.slice('ovmcp_'.length).split('.')
  if (!payloadB64 || !signatureB64) return null
  const signature = Buffer.from(signatureB64, 'base64url')
  const expected = signatureFor(payloadB64, secret)
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<string, unknown>
    if (parsed.v !== TOKEN_VERSION || typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) return null
    if (!STRING_CLAIMS.every((key) => typeof parsed[key] === 'string' && parsed[key])) return null
    const grant = parsed.grant as Partial<AgentMcpToolGrant> | undefined
    if (!grant || !Array.isArray(grant.allowedToolIds) || typeof grant.isDefaultMaster !== 'boolean') return null
    return {
      ...(Object.fromEntries(STRING_CLAIMS.map((key) => [key, parsed[key]])) as Pick<AgentMcpTokenClaims, typeof STRING_CLAIMS[number]>),
      memoryEnabled: parsed.memoryEnabled !== false,
      grant: {
        allowedToolIds: grant.allowedToolIds.filter((id): id is string => typeof id === 'string'),
        isDefaultMaster: grant.isDefaultMaster,
      },
      ...(typeof parsed.latestUserText === 'string' ? { latestUserText: parsed.latestUserText } : {}),
      expiresAt: parsed.expiresAt,
    }
  } catch (_error) {
    return null
  }
}
