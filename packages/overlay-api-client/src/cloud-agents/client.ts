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

/** Historical Overlay Cloud status and explicit cleanup for retired agents. */
export class CloudAgentsClient {
  constructor(private readonly http: HttpContext) {}

  status(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<CloudAgentStatusResource>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/machine`,
      { cache: 'no-store', ...workspaceInit(workspaceId, init) },
    )
  }

  remove(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<{ revoked: true; cleanupPending: number }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/machine`,
      { ...workspaceInit(workspaceId, init), method: 'DELETE' },
    )
  }
}
