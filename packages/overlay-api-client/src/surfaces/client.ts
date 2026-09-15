import type {
  SurfaceBinding,
  SurfaceChannelOption,
  SurfaceConnection,
} from '@overlay/workspace-contracts'
import type { HttpContext } from '../shared/http'

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

function workspaceInit(workspaceId: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set(WORKSPACE_HEADER, workspaceId)
  return { ...init, headers }
}

/**
 * Surfaces — external platform connections (one per platform install) and the
 * agent↔channel bindings routed through them. OAuth connect itself is a
 * browser redirect (`/api/v1/surfaces/slack/connect`), not a JSON call.
 */
export class SurfacesClient {
  constructor(private readonly http: HttpContext) {}

  listConnections(workspaceId: string, init?: RequestInit) {
    return this.http.json<{ connections: SurfaceConnection[] }>(
      '/api/v1/surfaces/connections', workspaceInit(workspaceId, init),
    )
  }

  listChannels(workspaceId: string, connectionId: string, init?: RequestInit) {
    return this.http.json<{ channels: SurfaceChannelOption[] }>(
      `/api/v1/surfaces/connections/${encodeURIComponent(connectionId)}/channels`,
      workspaceInit(workspaceId, init),
    )
  }

  listBindings(workspaceId: string, agentId: string, init?: RequestInit) {
    return this.http.json<{ bindings: SurfaceBinding[]; canBind: boolean }>(
      `/api/v1/surfaces/bindings?agentId=${encodeURIComponent(agentId)}`,
      workspaceInit(workspaceId, init),
    )
  }

  createBinding(workspaceId: string, input: {
    agentId: string
    connectionId: string
    channelId: string
    channelName?: string
  }, init?: RequestInit) {
    return this.http.json<{ binding: SurfaceBinding }>(
      '/api/v1/surfaces/bindings',
      this.http.jsonRequest(input, { ...workspaceInit(workspaceId, init), method: 'POST' }),
    )
  }

  removeBinding(workspaceId: string, bindingId: string, init?: RequestInit) {
    return this.http.json<{ binding: SurfaceBinding }>(
      `/api/v1/surfaces/bindings/${encodeURIComponent(bindingId)}`,
      workspaceInit(workspaceId, { ...init, method: 'DELETE' }),
    )
  }
}
