import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { ConvexHttpClient } from 'convex/browser'
import type { FunctionReturnType } from 'convex/server'
import { z } from 'zod'
import { api } from '../../../convex/_generated/api'
import { resolveConvexUrl } from '@/server/database/convex-url'
import { deploymentEnv } from '@/server/env/deployment-env'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { AgentMcpTokenClaims } from './agent-mcp-token'

export type McpCallRecord = FunctionReturnType<typeof api.agents.mcpCalls.read>
export const mcpToolResultSchema = z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })), isError: z.boolean().optional() })
export type McpToolResult = z.infer<typeof mcpToolResultSchema>

/** Stable argument identity, independent of JSON object key ordering. */
export function canonicalMcpArguments(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalMcpArguments).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalMcpArguments(entry)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/** One request-scoped client; binary result chunks use the SDK's actual Convex value encoding. */
export class McpCallJournal {
  private readonly authority
  constructor(
    claims: AgentMcpTokenClaims,
    private readonly client: Pick<ConvexHttpClient, 'query' | 'mutation'>,
    serverSecret: string,
  ) {
    if (!claims.sessionId) throw Error('A durable MCP call requires an execution session')
    this.authority = { serverSecret, workspaceId: claims.workspaceId, environmentId: claims.environmentId,
      runId: claims.runId, sessionId: claims.sessionId, expiresAt: claims.expiresAt,
      ...(claims.execution ? { execution: claims.execution } : {}) }
  }

  register(clientSessionId: string, rpcId: string | number | null, toolName: string, input: unknown) {
    return this.client.mutation(api.agents.mcpCalls.register, { ...this.authority, callId: randomUUID(), clientSessionId,
      rpcId: JSON.stringify(rpcId), toolName, argumentsJson: canonicalMcpArguments(input ?? {}) })
  }

  read(callId: string) { return this.client.query(api.agents.mcpCalls.read, { ...this.authority, callId }) }
  acknowledgeElicitation(callId: string) { return this.client.mutation(api.agents.mcpCalls.acknowledgeElicitation, { ...this.authority, callId }) }
  claim(callId: string, executionId: string, approvalRequired: boolean) {
    return this.client.mutation(api.agents.mcpCalls.claim, { ...this.authority, callId, executionId, approvalRequired })
  }

  async saveResult(callId: string, executionId: string, result: McpToolResult) {
    const bytes = new TextEncoder().encode(JSON.stringify(mcpToolResultSchema.parse(result)))
    let chunks = 0
    for (let start = 0; start < bytes.length; start += 65536) {
      await this.client.mutation(api.agents.mcpCalls.appendResult, { ...this.authority, callId, executionId,
        index: chunks++, data: bytes.slice(start, start + 65536).buffer })
    }
    await this.client.mutation(api.agents.mcpCalls.complete, { ...this.authority, callId, executionId,
      chunks, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }

  async result(call: McpCallRecord): Promise<McpToolResult> {
    if (call.state.kind !== 'completed') throw Error('MCP result is not complete')
    const chunks: Uint8Array[] = []
    for (let start = 0; start < call.state.chunks;) {
      const page = await this.client.query(api.agents.mcpCalls.readResult, { ...this.authority, callId: call.callId, start })
      if (!page.length || page.some((part, index) => part.index !== start + index)) throw Error('MCP result is incomplete')
      chunks.push(...page.map(part => new Uint8Array(part.data)))
      start += page.length
    }
    const bytes = Buffer.concat(chunks)
    if (bytes.length !== call.state.bytes || createHash('sha256').update(bytes).digest('hex') !== call.state.sha256) throw Error('MCP result integrity check failed')
    return mcpToolResultSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  }
}

export function createMcpCallJournal(claims: AgentMcpTokenClaims) {
  const { url, invalid } = resolveConvexUrl(deploymentEnv())
  if (!url || invalid) throw Error('MCP call storage is unavailable')
  const client = new ConvexHttpClient(url, { logger: false, skipConvexDeploymentUrlCheck: true,
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }),
  })
  return new McpCallJournal(claims, client, getInternalApiSecret())
}
