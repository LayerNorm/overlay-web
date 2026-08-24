import type { AgentEnvironment, AgentFilesystemGrant } from '@overlay/workspace-contracts'
import type { HttpContext } from '../shared/http'

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

export type AgentEnvironmentResource = Omit<AgentEnvironment, 'publicKey'> & {
  verificationPhrase?: string
  enrollmentExpiresAt?: number
}

function workspaceInit(workspaceId: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set(WORKSPACE_HEADER, workspaceId)
  return { ...init, headers }
}

export class AgentEnvironmentsClient {
  constructor(private readonly http: HttpContext) {}

  list(workspaceId: string, init?: RequestInit) {
    return this.http.json<{ environments: AgentEnvironmentResource[] }>(
      '/api/v1/agent-environments', workspaceInit(workspaceId, init),
    )
  }

  createEnrollment(workspaceId: string, init?: RequestInit) {
    return this.http.json<{ enrollmentSessionId: string; code: string; command: string; expiresAt: number }>(
      '/api/v1/agent-environments/enrollment-sessions',
      workspaceInit(workspaceId, { ...init, method: 'POST' }),
    )
  }

  approve(workspaceId: string, environmentId: string, filesystemGrant: AgentFilesystemGrant, init?: RequestInit) {
    return this.http.json<{ environment: AgentEnvironmentResource }>(
      `/api/v1/agent-environments/${encodeURIComponent(environmentId)}/approve`,
      this.http.jsonRequest({ filesystemGrant }, { ...workspaceInit(workspaceId, init), method: 'POST' }),
    )
  }

  updateRoots(workspaceId: string, environmentId: string, filesystemGrant: AgentFilesystemGrant, init?: RequestInit) {
    return this.http.json<{ environment: AgentEnvironmentResource }>(
      `/api/v1/agent-environments/${encodeURIComponent(environmentId)}/roots`,
      this.http.jsonRequest({ filesystemGrant }, { ...workspaceInit(workspaceId, init), method: 'PATCH' }),
    )
  }

  revoke(workspaceId: string, environmentId: string, init?: RequestInit) {
    return this.http.json<{ revoked: true; environmentId: string }>(
      `/api/v1/agent-environments/${encodeURIComponent(environmentId)}/revoke`,
      workspaceInit(workspaceId, { ...init, method: 'POST' }),
    )
  }
}
