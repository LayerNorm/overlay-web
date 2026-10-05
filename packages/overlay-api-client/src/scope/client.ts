import type { MutationSuccessResponse, ResourceScope, ScopeActionRequest, ScopedResourceKind } from '@overlay/app-core'
import type { HttpContext } from '../shared/http'

/** Move a resource between Personal and Workspace, archive it, or restore it. The server enforces who may do what. */
export class ScopeClient {
  constructor(private readonly http: HttpContext) {}

  private send(body: ScopeActionRequest, init?: RequestInit) {
    return this.http.jsonRequest(body, { ...init, method: 'POST' })
  }

  move(resource: ScopedResourceKind, id: string, to: ResourceScope, init?: RequestInit) {
    return this.http.json<MutationSuccessResponse>('/api/v1/scope', this.send({ resource, id, action: 'move', to }, init))
  }

  archive(resource: ScopedResourceKind, id: string, init?: RequestInit) {
    return this.http.json<MutationSuccessResponse>('/api/v1/scope', this.send({ resource, id, action: 'archive' }, init))
  }

  restore(resource: ScopedResourceKind, id: string, init?: RequestInit) {
    return this.http.json<MutationSuccessResponse>('/api/v1/scope', this.send({ resource, id, action: 'restore' }, init))
  }
}
