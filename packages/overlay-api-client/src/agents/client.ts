import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentListResponse,
  WorkspaceAgentUpdateInput,
} from '@overlay/workspace-contracts'
import type { HttpContext } from '../shared/http'

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

function workspaceInit(workspaceId: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set(WORKSPACE_HEADER, workspaceId)
  return { ...init, headers }
}

export class AgentsClient {
  constructor(private readonly http: HttpContext) {}

  list(workspaceId: string, init?: RequestInit) {
    return this.http.json<WorkspaceAgentListResponse>('/api/v1/agents', workspaceInit(workspaceId, init))
  }

  get(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<{ agent: WorkspaceAgentDirectoryItem }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}`,
      workspaceInit(workspaceId, init),
    )
  }

  create(workspaceId: string, body: WorkspaceAgentCreateInput, init?: RequestInit) {
    return this.http.json<{ agent: WorkspaceAgentDirectoryItem }>(
      '/api/v1/agents',
      this.http.jsonRequest(body, { ...workspaceInit(workspaceId, init), method: 'POST' }),
    )
  }

  update(workspaceId: string, agentId: string, body: WorkspaceAgentUpdateInput, init?: RequestInit) {
    return this.http.json<{ agent: WorkspaceAgentDirectoryItem }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}`,
      this.http.jsonRequest(body, { ...workspaceInit(workspaceId, init), method: 'PATCH' }),
    )
  }

  archive(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<{ archived: true }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}`,
      workspaceInit(workspaceId, { ...init, method: 'DELETE' }),
    )
  }
}
