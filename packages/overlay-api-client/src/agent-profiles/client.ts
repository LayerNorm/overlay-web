import type { HttpContext } from '../shared/http'

export type AgentProfileHarnessResource = 'claude-code' | 'codex'
export type AgentProfileImportCodeResource = { code: string; expiresAt: number; uploadUrl: string; command: string }

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

export type AgentProfileSummaryResource = {
  claudeMd: boolean; agentsMd: boolean; settings: boolean; skills: number; skillFiles: number; commands: number
  subagents: number; outputStyles: number; prompts: number; mcpServers: number; hooks: number; secrets: number
  dropped: number; files: number; bytes: number
}
export type AgentProfileResource = {
  id: string
  version: number
  status: 'awaiting_upload' | 'staged' | 'active' | 'superseded' | 'discarded'
  harness: AgentProfileHarnessResource
  summary: AgentProfileSummaryResource | null
  meta: {
    dropped: Array<{ path: string; reason: string }>
    droppedTotal: number
    redactions: Array<{ path: string; count: number }>
    warnings: Array<{ path: string; message: string }>
    secrets: Array<{ name: string; usedBy: string }>
    hooks: Array<{ kind: 'hook' | 'notify' | 'statusline'; event: string; command: string }>
    mcpServers: string[]
  } | null
  hooksEnabled: boolean
  createdAt: number
  uploadedAt: number | null
  appliedAt: number | null
  codeExpiresAt: number | null
}
export type AgentProfileStateResource = {
  profiles: AgentProfileResource[]
  secrets: Array<{ name: string; usedBy: string; set: boolean }>
}

/** Historical profile data and explicit cleanup for retired hosted agents. */
export class AgentProfilesClient {
  constructor(private readonly http: HttpContext) {}

  private url(agentId: string) {
    return `/api/v1/agents/${encodeURIComponent(agentId)}/profile`
  }

  private post<T>(workspaceId: string, agentId: string, body: Record<string, unknown>, init?: RequestInit) {
    const headers = new Headers(init?.headers)
    headers.set(WORKSPACE_HEADER, workspaceId)
    return this.http.json<T>(this.url(agentId), this.http.jsonRequest(body, { ...init, headers, method: 'POST' }))
  }

  state(workspaceId: string, agentId: string, init?: RequestInit) {
    const headers = new Headers(init?.headers)
    headers.set(WORKSPACE_HEADER, workspaceId)
    return this.http.json<AgentProfileStateResource>(this.url(agentId), { cache: 'no-store', ...init, headers })
  }

  discard(workspaceId: string, agentId: string, profileId: string) {
    return this.post<{ ok: true }>(workspaceId, agentId, { action: 'discard', profileId })
  }

  deleteSecret(workspaceId: string, agentId: string, name: string) {
    return this.post<{ ok: true }>(workspaceId, agentId, { action: 'delete_secret', name })
  }
}
