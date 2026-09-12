import type {
  Computer,
  ComputerOwnerType,
  ComputerSize,
} from '@overlay/workspace-contracts'
import type { HttpContext } from '../shared/http'

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

/**
 * A ready desktop stream ticket. The URL is a bearer secret — never log it.
 * Mirrors `DesktopStreamTicket`'s ready variant in `@overlay/sandbox-runtime`;
 * redeclared here so the client package does not depend on the runtime port.
 */
export type ComputerDesktopTicket = {
  url: string
  mode: 'webrtc' | 'vnc' | 'other'
  expiresAt: number | null
}

function workspaceInit(workspaceId: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set(WORKSPACE_HEADER, workspaceId)
  return { ...init, headers }
}

export class ComputersClient {
  constructor(private readonly http: HttpContext) {}

  list(workspaceId: string, init?: RequestInit) {
    return this.http.json<{ computers: Computer[] }>(
      '/api/v1/computers', workspaceInit(workspaceId, init),
    )
  }

  provision(workspaceId: string, input: {
    ownerType: ComputerOwnerType
    ownerId: string
    size?: ComputerSize
    name?: string
  }, init?: RequestInit) {
    return this.http.json<{ computer: Computer }>(
      '/api/v1/computers',
      this.http.jsonRequest(input, { ...workspaceInit(workspaceId, init), method: 'POST' }),
    )
  }

  get(workspaceId: string, computerId: string, init?: RequestInit) {
    return this.http.json<{ computer: Computer }>(
      `/api/v1/computers/${encodeURIComponent(computerId)}`, workspaceInit(workspaceId, init),
    )
  }

  openDesktop(workspaceId: string, computerId: string, mode?: 'webrtc' | 'vnc', init?: RequestInit) {
    return this.http.json<ComputerDesktopTicket>(
      `/api/v1/computers/${encodeURIComponent(computerId)}/desktop`,
      this.http.jsonRequest({ mode }, { ...workspaceInit(workspaceId, init), method: 'POST' }),
    )
  }

  stop(workspaceId: string, computerId: string, init?: RequestInit) {
    return this.http.json<{ computer: Computer }>(
      `/api/v1/computers/${encodeURIComponent(computerId)}/stop`,
      this.http.jsonRequest({}, { ...workspaceInit(workspaceId, init), method: 'POST' }),
    )
  }

  start(workspaceId: string, computerId: string, init?: RequestInit) {
    return this.http.json<{ computer: Computer }>(
      `/api/v1/computers/${encodeURIComponent(computerId)}/start`,
      this.http.jsonRequest({}, { ...workspaceInit(workspaceId, init), method: 'POST' }),
    )
  }

  destroy(workspaceId: string, computerId: string, init?: RequestInit) {
    return this.http.request(
      `/api/v1/computers/${encodeURIComponent(computerId)}`,
      workspaceInit(workspaceId, { ...init, method: 'DELETE' }),
    )
  }
}
