import type { HttpContext } from '../shared/http'
import type { QueryParams } from '../shared/types'
import type {
  CreateWorkItemRequest,
  CreateWorkItemResponse,
  UpdateWorkItemRequest,
  UpdateWorkItemResponse,
  WorkItemDetailDoc,
  WorkItemDoc,
  WorkItemQuery,
} from './types'

export class WorkItemsClient {
  constructor(private readonly http: HttpContext) {}

  private path(query?: WorkItemQuery): string {
    return this.http.appendQuery('/api/v1/work-items', query as QueryParams | undefined)
  }

  list<T = WorkItemDoc[]>(query?: WorkItemQuery, init?: RequestInit) {
    return this.http.jsonData<T>(this.path(query), init)
  }

  get<T = WorkItemDetailDoc>(itemId: string, init?: RequestInit) {
    return this.http.jsonData<T>(this.path({ itemId }), init)
  }

  getResponse(query?: WorkItemQuery, init?: RequestInit) {
    return this.http.request(this.path(query), init)
  }

  create(body: CreateWorkItemRequest, init?: RequestInit) {
    return this.http.json<CreateWorkItemResponse>('/api/v1/work-items', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  createResponse(body: CreateWorkItemRequest, init?: RequestInit) {
    return this.http.request('/api/v1/work-items', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  update(body: UpdateWorkItemRequest, init?: RequestInit) {
    return this.http.json<UpdateWorkItemResponse>('/api/v1/work-items', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  updateResponse(body: UpdateWorkItemRequest, init?: RequestInit) {
    return this.http.request('/api/v1/work-items', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  deleteResponse(query: { itemId: string }, init?: RequestInit) {
    return this.http.request(this.path(query), { ...init, method: 'DELETE' })
  }
}
