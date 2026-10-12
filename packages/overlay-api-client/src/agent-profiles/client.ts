import type { HttpContext } from '../shared/http'

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

export type AgentProfileHarnessResource = 'claude-code' | 'codex'
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
export type AgentProfileImportCodeResource = { code: string; expiresAt: number; uploadUrl: string; command: string }

/** An Overlay Cloud agent's imported Claude Code / Codex config: import, review, apply, roll back, and the values it needs. */
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

  createImportCode(workspaceId: string, agentId: string, harness: AgentProfileHarnessResource) {
    return this.post<AgentProfileImportCodeResource>(workspaceId, agentId, { action: 'import_code', harness })
  }

  apply(workspaceId: string, agentId: string, profileId: string, hooksEnabled?: boolean) {
    return this.post<{ version: number }>(workspaceId, agentId, { action: 'apply', profileId, ...(hooksEnabled === undefined ? {} : { hooksEnabled }) })
  }

  discard(workspaceId: string, agentId: string, profileId: string) {
    return this.post<{ ok: true }>(workspaceId, agentId, { action: 'discard', profileId })
  }

  setHooks(workspaceId: string, agentId: string, profileId: string, enabled: boolean) {
    return this.post<{ ok: true }>(workspaceId, agentId, { action: 'hooks', profileId, enabled })
  }

  setSecret(workspaceId: string, agentId: string, name: string, value: string) {
    return this.post<{ ok: true }>(workspaceId, agentId, { action: 'set_secret', name, value })
  }

  deleteSecret(workspaceId: string, agentId: string, name: string) {
    return this.post<{ ok: true }>(workspaceId, agentId, { action: 'delete_secret', name })
  }
}
