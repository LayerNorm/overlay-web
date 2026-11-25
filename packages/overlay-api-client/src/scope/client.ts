import type { MutationSuccessResponse, ScopeActionRequest, ScopedResourceKind } from '@overlay/app-core'
import type { HttpContext } from '../shared/http'

/** Move a resource from Personal to Workspace (one-way), archive it, or restore it. The server enforces who may do what. */
export class ScopeClient {
  constructor(private readonly http: HttpContext) {}

  private send(body: ScopeActionRequest, init?: RequestInit) {
    return this.http.jsonRequest(body, { ...init, method: 'POST' })
  }

  /** `withAgent` (automations only) also moves the automation's creator-only agent to the workspace. */
  move(resource: ScopedResourceKind, id: string, to: 'workspace', options?: { withAgent?: boolean }, init?: RequestInit) {
    return this.http.json<MutationSuccessResponse>('/api/v1/scope', this.send({ resource, id, action: 'move', to, ...(options?.withAgent ? { withAgent: true } : {}) }, init))
  }

  archive(resource: ScopedResourceKind, id: string, init?: RequestInit) {
    return this.http.json<MutationSuccessResponse>('/api/v1/scope', this.send({ resource, id, action: 'archive' }, init))
  }

  restore(resource: ScopedResourceKind, id: string, init?: RequestInit) {
    return this.http.json<MutationSuccessResponse>('/api/v1/scope', this.send({ resource, id, action: 'restore' }, init))
  }
}
