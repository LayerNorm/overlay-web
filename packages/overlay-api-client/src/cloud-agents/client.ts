import type { HttpContext } from '../shared/http'

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

export type CloudAgentPhaseResource = 'queued' | 'allocating' | 'booting' | 'connecting' | 'ready' | 'failed'
export type CloudAgentStateResource = 'ready' | 'paused' | 'starting' | 'needs_sign_in' | 'failed' | 'unavailable'

export type CloudAgentStatusResource = {
  agentId: string
  adapterId?: string
  provision: { phase: CloudAgentPhaseResource; error?: string; updatedAt: number } | null
  environment: { id: string; status: string; lastSeenAt?: number; createdAt: number } | null
  machine: { state: 'running' | 'stopped' | 'unknown'; size?: string; image?: string; adapterId?: string } | null
  account: { id: string; label: string; provider: string; method: string; status: 'active' | 'needs_reauth' } | null
  state: CloudAgentStateResource
}

function workspaceInit(workspaceId: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set(WORKSPACE_HEADER, workspaceId)
  return { ...init, headers }
}

/** An agent's Overlay Cloud machine: start it, watch it start, pause/resume/restart, delete. */
export class CloudAgentsClient {
  constructor(private readonly http: HttpContext) {}

  /** Starts provisioning and returns at once (202); poll `status` for progress. */
  provision(
    workspaceId: string,
    input: { agentId: string; adapterId: 'claude-code' | 'codex' | 'opencode' | 'hermes' | 'cursor'; providerAccountId: string; size?: 'small' | 'default' | 'large' },
    init?: RequestInit,
  ) {
    return this.http.json<{ phase: CloudAgentPhaseResource }>(
      '/api/v1/agent-environments/cloud',
      this.http.jsonRequest(input, { ...workspaceInit(workspaceId, init), method: 'POST' }),
    )
  }

  status(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<CloudAgentStatusResource>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/machine`,
      { cache: 'no-store', ...workspaceInit(workspaceId, init) },
    )
  }

  control(workspaceId: string, agentId: string, action: 'pause' | 'resume' | 'restart', init?: RequestInit) {
    return this.http.json<{ ok: true }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/machine`,
      this.http.jsonRequest({ action }, { ...workspaceInit(workspaceId, init), method: 'POST' }),
    )
  }

  remove(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<{ deleted: true }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/machine`,
      { ...workspaceInit(workspaceId, init), method: 'DELETE' },
    )
  }
}
