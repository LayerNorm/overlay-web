import type {
  AgentBinding,
  AgentEnvironment,
  AgentFilesystemGrant,
  BuiltInUserOwnedAcpAdapterId,
  ManagedHarnessId,
} from '@overlay/workspace-contracts'
import type { HttpContext } from '../shared/http'

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

export type AgentEnvironmentResource = Omit<AgentEnvironment, 'publicKey'> & {
  verificationPhrase?: string
  enrollmentExpiresAt?: number
}

/** One row of the managed-harness picker, as served by `GET .../managed`. */
export type ManagedHarnessPickerEntry = {
  id: ManagedHarnessId
  label: string
  description: string
  byokProviders: string[]
  models: Array<{ value: string; label: string; harnessModel?: string; billingModelId: string }>
}

export type ManagedHarnessPicker = {
  harnesses: ManagedHarnessPickerEntry[]
  providers: string[]
  workingDirectory: string
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

  createManaged(
    workspaceId: string,
    input?:
      | { adapterId?: 'codex' | 'claude-code' }
      | { mode: 'harness'; harnessId: ManagedHarnessId; provider?: string },
    init?: RequestInit,
  ) {
    return this.http.json<{
      environment: AgentEnvironmentResource
      lease: { id: string; status: string }
      setup:
        | { label: 'Overlay Cloud'; approvedRoot: string; adapterId: 'codex' | 'claude-code' }
        | { label: 'Overlay Cloud'; approvedRoot: string; mode: 'harness'; harnessId: ManagedHarnessId; provider: string }
    }>(
      '/api/v1/agent-environments/managed',
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

  /** Harness runtimes this workspace may host on Overlay Cloud (404 when gated). */
  managedHarnesses(workspaceId: string, init?: RequestInit) {
    return this.http.json<ManagedHarnessPicker>('/api/v1/agent-environments/managed', workspaceInit(workspaceId, init))
  }

  resetHarness(workspaceId: string, environmentId: string, init?: RequestInit) {
    return this.http.json<{ reset: true; sessionsCleared: number; sandboxDestroyed: boolean; environmentId: string }>(
      `/api/v1/agent-environments/${encodeURIComponent(environmentId)}/reset-harness`,
      workspaceInit(workspaceId, { ...init, method: 'POST' }),
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
