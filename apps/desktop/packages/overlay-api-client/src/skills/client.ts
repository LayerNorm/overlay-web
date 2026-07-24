import type {
  CreateEntityResponse,
  CreateSkillRequest,
  MutationSuccessResponse,
  SkillSummary,
  UpdateSkillRequest,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'
import type { PaginatedEnvelope, QueryParams } from '../shared/types'
import type { SkillQuery } from './types'

export class SkillsClient {
  constructor(private readonly http: HttpContext) {}

  private path(query?: SkillQuery): string {
    return this.http.appendQuery('/api/v1/skills', query as QueryParams | undefined)
  }

  get<T = SkillSummary[]>(query?: SkillQuery, init?: RequestInit) {
    return this.http.jsonData<T>(this.path(query), init)
  }

  getPage<T = SkillSummary>(query?: SkillQuery, init?: RequestInit) {
    return this.http.json<PaginatedEnvelope<T>>(this.path(query), init)
  }

  getResponse(query?: SkillQuery, init?: RequestInit) {
    return this.http.request(this.path(query), init)
  }

  create(body: CreateSkillRequest, init?: RequestInit) {
    return this.http.json<CreateEntityResponse>('/api/v1/skills', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  createResponse(body: CreateSkillRequest, init?: RequestInit) {
    return this.http.request('/api/v1/skills', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  update(body: UpdateSkillRequest, init?: RequestInit) {
    return this.http.json<MutationSuccessResponse>(
      '/api/v1/skills',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  updateResponse(body: UpdateSkillRequest, init?: RequestInit) {
    return this.http.request('/api/v1/skills', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  deleteResponse(query: { skillId: string }, init?: RequestInit) {
    return this.http.request(this.path(query), { ...init, method: 'DELETE' })
  }
}
