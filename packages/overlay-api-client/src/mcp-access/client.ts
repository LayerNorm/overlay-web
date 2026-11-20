import type { HttpContext } from '../shared/http'

export type McpAccessLevelResource = 'read' | 'write' | 'full'

export type McpConnectionResource = {
  id: string
  name: string
  kind: 'oauth' | 'token'
  access: McpAccessLevelResource
  workspaceId: string
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number | null
}

export type McpAgentResource = {
  id: string
  name: string
  description: string
  status: 'pending' | 'approved'
  paused: boolean
  availability: 'online' | 'away' | 'paused' | null
  ownedByYou: boolean
  agentId: string | null
  requestedAt: number
  lastSeenAt: number | null
}

/** Other AI apps (ChatGPT, Claude, Cursor, local agents) connected to Overlay's MCP server. */
export class McpAccessClient {
  constructor(private readonly http: HttpContext) {}

  connections(init?: RequestInit) {
    return this.http.json<{ endpoint: string; data: McpConnectionResource[] }>('/api/v1/mcp/connections', { cache: 'no-store', ...init })
  }

  createToken(input: { name?: string; workspaceId: string; access: McpAccessLevelResource; ttlDays?: number }, init?: RequestInit) {
    return this.http.json<{ token: string; endpoint: string; connection: { id: string; name: string; access: McpAccessLevelResource; workspaceId: string; expiresAt: number | null } }>(
      '/api/v1/mcp/connections',
      this.http.jsonRequest(input, { ...init, method: 'POST' }),
    )
  }

  revoke(id: string, init?: RequestInit) {
    return this.http.json<{ ok: true }>(`/api/v1/mcp/connections?id=${encodeURIComponent(id)}`, { ...init, method: 'DELETE' })
  }

  /** Outside agents that joined, or asked to join, the current workspace. */
  agents(init?: RequestInit) {
    return this.http.json<{ canApprove: boolean; agents: McpAgentResource[] }>('/api/v1/mcp/agents', { cache: 'no-store', ...init })
  }

  updateAgent(input: { id: string; action: 'approve' | 'decline' | 'pause' | 'resume' | 'remove' }, init?: RequestInit) {
    return this.http.json<{ ok: true }>('/api/v1/mcp/agents', this.http.jsonRequest(input, { ...init, method: 'POST' }))
  }

  describeClient(input: { clientId: string; redirectUri: string }, init?: RequestInit) {
    const query = new URLSearchParams(input)
    return this.http.json<{ name: string; redirectHost: string }>(`/api/v1/mcp/client?${query}`, { cache: 'no-store', ...init })
  }

  authorize(
    input: { clientId: string; redirectUri: string; state?: string; decision: 'approve' | 'deny'; workspaceId?: string; access?: McpAccessLevelResource; codeChallenge?: string },
    init?: RequestInit,
  ) {
    return this.http.json<{ redirectUrl: string }>('/api/v1/mcp/authorize', this.http.jsonRequest(input, { ...init, method: 'POST' }))
  }
}
