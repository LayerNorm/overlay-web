import type {
  AgentBinding,
  AgentEnvironment,
  AgentFilesystemGrant,
  BuiltInUserOwnedAcpAdapterId,
} from '@overlay/workspace-contracts'
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

  createEnrollment(workspaceId: string, input?: { adapterId?: BuiltInUserOwnedAcpAdapterId }, init?: RequestInit) {
    return this.http.json<{ enrollmentSessionId: string; code: string; command: string; expiresAt: number }>(
      '/api/v1/agent-environments/enrollment-sessions',
      this.http.jsonRequest(input ?? {}, { ...workspaceInit(workspaceId, init), method: 'POST' }),
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

  listBindings(workspaceId: string, agentId?: string, init?: RequestInit) {
    const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''
    return this.http.json<{ bindings: AgentBinding[] }>(
      `/api/v1/agent-bindings${query}`, workspaceInit(workspaceId, init),
    )
  }

  /**
   * Live desktop ticket for an Overlay Cloud environment's machine — the
   * environment's sandbox doubles as the bound agent's computer.
   */
  openDesktop(workspaceId: string, environmentId: string, mode?: 'webrtc' | 'vnc', init?: RequestInit) {
    return this.http.json<{ url: string; mode: 'webrtc' | 'vnc' | 'other'; expiresAt: number | null }>(
      `/api/v1/agent-environments/${encodeURIComponent(environmentId)}/desktop`,
      this.http.jsonRequest({ mode }, { ...workspaceInit(workspaceId, init), method: 'POST' }),
    )
  }

  upsertBinding(workspaceId: string, input: {
    agentId: string
    environmentId: string
    adapterId: string
    workingDirectory: string
    model?: string
    modelBilling?: 'overlay' | 'byok'
    byokConnectionId?: string
  }, init?: RequestInit) {
    return this.http.json<{ binding: AgentBinding }>(
      '/api/v1/agent-bindings',
      this.http.jsonRequest(input, { ...workspaceInit(workspaceId, init), method: 'PUT' }),
    )
  }

  disableBindings(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<{ disabled: boolean }>(
      `/api/v1/agent-bindings?agentId=${encodeURIComponent(agentId)}`,
      workspaceInit(workspaceId, { ...init, method: 'DELETE' }),
    )
  }
}
