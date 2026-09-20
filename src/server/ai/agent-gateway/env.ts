import 'server-only'

import { getBaseUrl } from '@/server/web/app-url'
import { mintAgentGatewayToken, AGENT_GATEWAY_TOKEN_TTL_MS } from './token'

/**
 * Per-command environment for exec surfaces running on Overlay machines.
 * Points the well-known CLI base-url vars at the metered agent gateway with a
 * short-lived scoped token, so `claude`, `codex`, `opencode`, etc. inside a
 * box hold no real provider keys — and their spend lands on the workspace's
 * agent budget through the normal reserve/finalize pipeline.
 *
 * Returns {} when no signing secret is configured (self-hosted deployments
 * without INTERNAL_API_SECRET) — CLIs then behave as if unauthenticated.
 */
export function agentGatewayExecEnv(args: {
  workspaceId: string
  userId: string
  agentId?: string
  ttlMs?: number
}): Record<string, string> {
  const token = mintAgentGatewayToken({
    userId: args.userId,
    workspaceId: args.workspaceId,
    agentId: args.agentId,
    ttlMs: args.ttlMs,
  })
  if (!token) return {}
  const base = getBaseUrl().replace(/\/+$/, '')
  return {
    ANTHROPIC_BASE_URL: `${base}/api/agent-gateway/anthropic`,
    // Both spellings: the Anthropic SDK reads ANTHROPIC_API_KEY (x-api-key),
    // claude-code also honors ANTHROPIC_AUTH_TOKEN (Authorization: Bearer).
    ANTHROPIC_API_KEY: token,
    ANTHROPIC_AUTH_TOKEN: token,
    // OpenAI SDKs treat the base as the API root including the version segment.
    OPENAI_BASE_URL: `${base}/api/agent-gateway/openai/v1`,
    OPENAI_API_KEY: token,
    OVERLAY_GATEWAY_TOKEN: token,
    OVERLAY_GATEWAY_TOKEN_TTL_MS: String(AGENT_GATEWAY_TOKEN_TTL_MS),
  }
}
