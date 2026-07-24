import type {
  CreateProjectRequest,
  CreateProjectResponse,
  DeleteProjectResponse,
  ProjectSummary,
  UpdateProjectRequest,
  UpdateProjectResponse,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'
import type { PaginatedEnvelope, QueryParams } from '../shared/types'
import type { ProjectQuery } from './types'

export class ProjectsClient {
  constructor(private readonly http: HttpContext) {}

  private path(query?: ProjectQuery): string {
    return this.http.appendQuery('/api/v1/projects', query as QueryParams | undefined)
  }

  get<T = ProjectSummary[] | ProjectSummary>(query?: ProjectQuery, init?: RequestInit) {
    return this.http.jsonData<T>(this.path(query), init)
  }

  getPage<T = ProjectSummary>(query?: ProjectQuery, init?: RequestInit) {
    return this.http.json<PaginatedEnvelope<T>>(this.path(query), init)
  }

  getResponse(query?: ProjectQuery, init?: RequestInit) {
    return this.http.request(this.path(query), init)
  }

  create(body: CreateProjectRequest, init?: RequestInit) {
    return this.http.json<CreateProjectResponse>(
      '/api/v1/projects',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  createResponse(body: CreateProjectRequest, init?: RequestInit) {
    return this.http.request('/api/v1/projects', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  update(body: UpdateProjectRequest, init?: RequestInit) {
    return this.http.json<UpdateProjectResponse>(
      '/api/v1/projects',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  updateResponse(body: UpdateProjectRequest, init?: RequestInit) {
    return this.http.request('/api/v1/projects', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  deleteResponse(query: { projectId: string }, init?: RequestInit) {
    return this.http.request(this.path(query), { ...init, method: 'DELETE' })
  }

  parseDeleteResponse(response: Response) {
    return this.http.parseJson<DeleteProjectResponse>(response)
  }
}
