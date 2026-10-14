import type {
  AddWorkCommentRequest,
  CreateWorkItemRequest,
  MoveWorkItemRequest,
  MutationSuccessResponse,
  UpdateWorkItemRequest,
  WorkContext,
  WorkEventListResponse,
  WorkItemListResponse,
  WorkItemResponse,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'
import type { QueryParams } from '../shared/types'
import type { WorkQuery } from './types'

/** Tasks (Work). Moving a task between Personal and Workspace, archiving and restoring go through `scope`. */
export class WorkClient {
  constructor(private readonly http: HttpContext) {}

  private itemPath(id: string, suffix = ''): string {
    return `/api/v1/work/${encodeURIComponent(id)}${suffix}`
  }

  list(query?: WorkQuery, init?: RequestInit) {
    return this.http.json<WorkItemListResponse>(this.http.appendQuery('/api/v1/work', query as QueryParams | undefined), init)
  }

  context(init?: RequestInit) {
    return this.http.json<WorkContext>('/api/v1/work/context', init)
  }

  get(id: string, init?: RequestInit) {
    return this.http.json<WorkItemResponse>(this.itemPath(id), init)
  }

  create(body: CreateWorkItemRequest, init?: RequestInit) {
    return this.http.json<WorkItemResponse>('/api/v1/work', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  update(id: string, body: UpdateWorkItemRequest, init?: RequestInit) {
    return this.http.json<WorkItemResponse>(this.itemPath(id), this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  move(id: string, body: MoveWorkItemRequest, init?: RequestInit) {
    return this.http.json<WorkItemResponse>(this.itemPath(id, '/move'), this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  events(id: string, init?: RequestInit) {
    return this.http.json<WorkEventListResponse>(this.itemPath(id, '/events'), init)
  }

  addComment(id: string, body: AddWorkCommentRequest, init?: RequestInit) {
    return this.http.json<MutationSuccessResponse>(this.itemPath(id, '/events'), this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }
}
