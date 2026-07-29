import type {
  CreateProjectRequest,
  CreateProjectResponse,
  DeleteProjectResponse,
  KnowledgeBase,
  ProjectExport,
  ProjectKnowledgeBase,
  ProjectKnowledgeTransferRequest,
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

  private knowledgeBasePath(query?: { projectId: string; knowledgeBaseId?: string }): string {
    return this.http.appendQuery(
      '/api/v1/projects/knowledge-bases',
      query as QueryParams | undefined,
    )
  }

  listKnowledgeBases(query: { projectId: string }, init?: RequestInit) {
    return this.http.json<{ knowledgeBases: KnowledgeBase[] }>(
      this.knowledgeBasePath(query),
      init,
    )
  }

  attachKnowledgeBase(body: { projectId: string; knowledgeBaseId: string }, init?: RequestInit) {
    return this.http.json<{ success: boolean; attachment: ProjectKnowledgeBase }>(
      '/api/v1/projects/knowledge-bases',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  detachKnowledgeBase(query: { projectId: string; knowledgeBaseId: string }, init?: RequestInit) {
    return this.http.json<{ success: boolean }>(
      this.knowledgeBasePath(query),
      { ...init, method: 'DELETE' },
    )
  }

  listTemplates(init?: RequestInit) {
    return this.http.json<{ templates: ProjectSummary[] }>('/api/v1/projects/duplicate', init)
  }

  duplicate(
    body: { sourceProjectId: string; name?: string },
    init?: RequestInit,
  ) {
    return this.http.json<{ id: string; project: ProjectSummary }>(
      '/api/v1/projects/duplicate',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  transfer(body: ProjectKnowledgeTransferRequest, init?: RequestInit) {
    return this.http.json<{ success: true; sourceId?: string; noteId?: string; jobId?: string }>(
      '/api/v1/projects/knowledge-transfer',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  exportProject(query: { projectId: string }, init?: RequestInit) {
    return this.http.json<ProjectExport>(
      this.http.appendQuery('/api/v1/projects/export', query),
      init,
    )
  }
}
