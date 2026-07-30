import type { HttpContext } from '../shared/http'
import type { WorkspaceSharedResource } from '../sharing/client'

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

export type WorkspaceSearchQuery = {
  q: string
  /** Restricts the search; omitted means every kind the workspace supports. */
  kinds?: string[]
  limit?: number
}

export class SearchClient {
  constructor(private readonly http: HttpContext) {}

  /**
   * Workspace-wide, permission-filtered search. Omitting workspaceId lets the
   * server scope the search to the caller's active workspace.
   */
  workspace(workspaceId: string | null | undefined, query: WorkspaceSearchQuery, init?: RequestInit) {
    const headers = new Headers(init?.headers)
    if (workspaceId) headers.set(WORKSPACE_HEADER, workspaceId)
    return this.http.json<{
      query: string
      results: WorkspaceSharedResource[]
      kinds: string[]
    }>(
      this.http.appendQuery('/api/v1/search', {
        q: query.q,
        ...(query.kinds?.length ? { kinds: query.kinds.join(',') } : {}),
        ...(query.limit ? { limit: String(query.limit) } : {}),
      }),
      { ...init, headers },
    )
  }
}
