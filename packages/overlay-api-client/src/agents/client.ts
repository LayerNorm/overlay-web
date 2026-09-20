import type {
  WorkspaceAgentAutomation,
  WorkspaceAgentBundle,
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentListResponse,
  WorkspaceAgentThread,
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

  list(workspaceId: string, init?: RequestInit & { includeArchived?: boolean }) {
    const { includeArchived, ...rest } = init ?? {}
    const suffix = includeArchived ? '?includeArchived=true' : ''
    return this.http.json<WorkspaceAgentListResponse>(
      `/api/v1/agents${suffix}`,
      workspaceInit(workspaceId, rest),
    )
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

  restore(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<{ restored: true }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/restore`,
      workspaceInit(workspaceId, { ...init, method: 'POST' }),
    )
  }

  bundle(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<WorkspaceAgentBundle>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/bundle`,
      workspaceInit(workspaceId, init),
    )
  }

  listThreads(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<{ threads: WorkspaceAgentThread[] }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/threads`,
      workspaceInit(workspaceId, init),
    )
  }

  listAgentAutomations(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<{ automations: WorkspaceAgentAutomation[] }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/automations`,
      workspaceInit(workspaceId, init),
    )
  }

  resolveMainThread(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<{ thread: { conversationId: string; title: string } }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/threads/resolve`,
      workspaceInit(workspaceId, { ...init, method: 'POST' }),
    )
  }

  createThread(workspaceId: string, agentId: string, body: { title?: string }, init?: RequestInit) {
    return this.http.json<{ thread: { conversationId: string; title: string } }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/threads`,
      this.http.jsonRequest(body, { ...workspaceInit(workspaceId, init), method: 'POST' }),
    )
  }

  setThreadArchived(
    workspaceId: string,
    agentId: string,
    threadId: string,
    archived: boolean,
    init?: RequestInit,
  ) {
    return this.http.json<{ ok: true }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}`,
      this.http.jsonRequest({ archived }, { ...workspaceInit(workspaceId, init), method: 'PATCH' }),
    )
  }

  deleteThread(workspaceId: string, agentId: string, threadId: string, init?: RequestInit) {
    return this.http.json<{ deleted: true }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}`,
      workspaceInit(workspaceId, { ...init, method: 'DELETE' }),
    )
  }
}
