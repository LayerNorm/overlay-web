import type { HttpContext } from '../shared/http'
import type {
  CreateKnowledgeBaseGrantRequest,
  DeleteKnowledgeBaseGrantRequest,
  DeleteKnowledgeBaseSourceRequest,
  SearchKnowledgeBaseRequest,
  UpdateKnowledgeBaseSourceRequest,
} from '../../../../src/shared/schemas/knowledge-bases'
import type {
  CreateKnowledgeBaseInput,
  CreateKnowledgeBaseSourceInput,
  KnowledgeBaseDetailResponse,
  KnowledgeBaseDiagnosticsResponse,
  KnowledgeBaseGrantsResponse,
  KnowledgeBaseListResponse,
  KnowledgeSourcePreviewResponse,
  KnowledgeBaseSearchResponse,
  KnowledgeBaseSourcesResponse,
  ReindexKnowledgeBaseResponse,
  UpdateKnowledgeBaseInput,
  AdministrativeKnowledgeBaseListResponse,
  KnowledgeBaseShareDirectoryResponse,
  GroupKnowledgeBaseDefaultsResponse,
} from './types'

export class KnowledgeBasesClient {
  constructor(private readonly http: HttpContext) {}

  list(init?: RequestInit) {
    return this.http.json<KnowledgeBaseListResponse>('/api/v1/knowledge-bases', init)
  }

  listPersonal(init?: RequestInit) {
    return this.http.json<KnowledgeBaseListResponse>('/api/v1/knowledge-bases/personal', init)
  }

  ensurePersonal(body: { title?: string } = {}, init?: RequestInit) {
    return this.http.json<KnowledgeBaseDetailResponse>(
      '/api/v1/knowledge-bases/personal',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  listAdministrative(init?: RequestInit) {
    return this.http.json<AdministrativeKnowledgeBaseListResponse>(
      '/api/v1/admin/knowledge-bases',
      init,
    )
  }

  listGroupDefaults(groupId?: string, init?: RequestInit) {
    return this.http.json<GroupKnowledgeBaseDefaultsResponse>(
      this.http.appendQuery('/api/v1/admin/knowledge-bases/defaults', { groupId }),
      init,
    )
  }

  setGroupDefault(body: {
    groupId: string
    knowledgeBaseId: string
  }, init?: RequestInit) {
    return this.http.json<GroupKnowledgeBaseDefaultsResponse['defaults'][number]>(
      '/api/v1/admin/knowledge-bases/defaults',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  removeGroupDefault(body: {
    groupId: string
    knowledgeBaseId: string
  }, init?: RequestInit) {
    return this.http.json<{ removed: true }>(
      '/api/v1/admin/knowledge-bases/defaults',
      this.http.jsonRequest(body, { ...init, method: 'DELETE' }),
    )
  }

  listShareDirectory(init?: RequestInit) {
    return this.http.json<KnowledgeBaseShareDirectoryResponse>(
      '/api/v1/knowledge-bases/share-directory',
      init,
    )
  }

  create(body: CreateKnowledgeBaseInput, init?: RequestInit) {
    return this.http.json<KnowledgeBaseDetailResponse>(
      '/api/v1/knowledge-bases',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  update(body: UpdateKnowledgeBaseInput, init?: RequestInit) {
    return this.http.json<KnowledgeBaseDetailResponse>(
      '/api/v1/knowledge-bases',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  remove(knowledgeBaseId: string, init?: RequestInit) {
    return this.http.json<{ deleted: boolean; knowledgeBaseId: string }>(
      '/api/v1/knowledge-bases',
      this.http.jsonRequest({ knowledgeBaseId }, { ...init, method: 'DELETE' }),
    )
  }

  listSources(knowledgeBaseId: string, init?: RequestInit) {
    return this.http.json<KnowledgeBaseSourcesResponse>(this.path(knowledgeBaseId, 'sources'), init)
  }

  createSource(knowledgeBaseId: string, body: CreateKnowledgeBaseSourceInput, init?: RequestInit) {
    return this.http.json<Record<string, unknown>>(
      this.path(knowledgeBaseId, 'sources'),
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  diagnostics(knowledgeBaseId: string, init?: RequestInit) {
    return this.http.json<KnowledgeBaseDiagnosticsResponse>(
      this.path(knowledgeBaseId, 'diagnostics'),
      init,
    )
  }

  extractionPreview(
    knowledgeBaseId: string,
    sourceId: string,
    previewLimit = 8_000,
    init?: RequestInit,
  ) {
    return this.http.json<KnowledgeSourcePreviewResponse>(
      this.http.appendQuery(this.path(knowledgeBaseId, 'diagnostics'), {
        sourceId,
        previewLimit,
      }),
      init,
    )
  }

  reindex(
    knowledgeBaseId: string,
    body: { sourceId?: string; onlyStale?: boolean } = {},
    init?: RequestInit,
  ) {
    return this.http.json<ReindexKnowledgeBaseResponse>(
      this.path(knowledgeBaseId, 'reindex'),
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  async uploadSource(knowledgeBaseId: string, file: File, init?: RequestInit) {
    const formData = new FormData()
    formData.set('file', file)
    return this.http.parseJson<Record<string, unknown>>(await this.http.request(
      this.path(knowledgeBaseId, 'sources/upload'),
      { ...init, method: 'POST', body: formData },
    ))
  }

  updateSource(knowledgeBaseId: string, body: UpdateKnowledgeBaseSourceRequest, init?: RequestInit) {
    return this.http.json<Record<string, unknown>>(
      this.path(knowledgeBaseId, 'sources'),
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  removeSource(knowledgeBaseId: string, body: DeleteKnowledgeBaseSourceRequest, init?: RequestInit) {
    return this.http.json<{ deleted: boolean; sourceId: string }>(
      this.path(knowledgeBaseId, 'sources'),
      this.http.jsonRequest(body, { ...init, method: 'DELETE' }),
    )
  }

  search(knowledgeBaseId: string, body: SearchKnowledgeBaseRequest, init?: RequestInit) {
    return this.http.json<KnowledgeBaseSearchResponse>(
      this.path(knowledgeBaseId, 'search'),
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  listConversations<T = unknown[]>(knowledgeBaseId: string, init?: RequestInit) {
    return this.http.json<{ conversations: T }>(this.path(knowledgeBaseId, 'conversations'), init)
  }

  listGrants(knowledgeBaseId: string, init?: RequestInit) {
    return this.http.json<KnowledgeBaseGrantsResponse>(this.path(knowledgeBaseId, 'grants'), init)
  }

  share(knowledgeBaseId: string, body: CreateKnowledgeBaseGrantRequest, init?: RequestInit) {
    return this.http.json<{ grant: KnowledgeBaseGrantsResponse['grants'][number] }>(
      this.path(knowledgeBaseId, 'grants'),
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  revokeShare(knowledgeBaseId: string, body: DeleteKnowledgeBaseGrantRequest, init?: RequestInit) {
    return this.http.json<{ removed: boolean; grantId: string }>(
      this.path(knowledgeBaseId, 'grants'),
      this.http.jsonRequest(body, { ...init, method: 'DELETE' }),
    )
  }

  private path(knowledgeBaseId: string, suffix: string) {
    return `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/${suffix}`
  }
}
