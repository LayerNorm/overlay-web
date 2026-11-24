import type {
  CreateMemoryRequest,
  CreateMemoryResponse,
  MemoryRow,
  UpdateMemoryRequest,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'
import type { PaginatedEnvelope, QueryParams } from '../shared/types'
import type { MemoryQuery } from './types'

export class MemoryClient {
  constructor(private readonly http: HttpContext) {}

  private path(query?: MemoryQuery): string {
    return this.http.appendQuery('/api/v1/memory', query as QueryParams | undefined)
  }

  get<T = MemoryRow[] | MemoryRow>(query?: MemoryQuery, init?: RequestInit) {
    return this.http.jsonData<T>(this.path(query), init)
  }

  getPage<T = MemoryRow>(query?: MemoryQuery, init?: RequestInit) {
    return this.http.json<PaginatedEnvelope<T>>(this.path(query), init)
  }

  getResponse(query?: MemoryQuery, init?: RequestInit) {
    return this.http.request(this.path(query), init)
  }

  create(body: CreateMemoryRequest, init?: RequestInit) {
    return this.http.json<CreateMemoryResponse>('/api/v1/memory', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  createResponse(body: CreateMemoryRequest, init?: RequestInit) {
    return this.http.request('/api/v1/memory', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  update(body: UpdateMemoryRequest, init?: RequestInit) {
    return this.http.json<{ success: boolean; memory?: MemoryRow | null; error?: string }>(
      '/api/v1/memory',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  updateResponse(body: UpdateMemoryRequest, init?: RequestInit) {
    return this.http.request('/api/v1/memory', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  deleteResponse(query: { memoryId: string }, init?: RequestInit) {
    return this.http.request(this.path(query), { ...init, method: 'DELETE' })
  }
}
