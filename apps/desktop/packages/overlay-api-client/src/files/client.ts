import type {
  CreateFileRequest,
  CreateFileResponse,
  FilePresignQuery,
  FilePresignResponse,
  FileShareRequest,
  FileShareResponse,
  FileTextSearchRequest,
  FileTextSearchResponse,
  FileUploadUrlRequest,
  FileUploadUrlResponse,
  KnowledgeFile,
  MutationSuccessResponse,
  UpdateFileRequest,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'
import type { MutationRequestInit } from '../shared/mutation'
import type { PaginatedEnvelope, QueryParams } from '../shared/types'
import type { FileQuery } from './types'

export class FilesClient {
  constructor(private readonly http: HttpContext) {}

  private path(query?: FileQuery): string {
    return this.http.appendQuery('/api/v1/files', query as QueryParams | undefined)
  }

  get<T = KnowledgeFile[] | KnowledgeFile>(query?: FileQuery, init?: RequestInit) {
    return this.http.jsonData<T>(this.path(query), init)
  }

  getPage<T = KnowledgeFile>(query?: FileQuery, init?: RequestInit) {
    return this.http.json<PaginatedEnvelope<T>>(this.path(query), init)
  }

  getResponse(query?: FileQuery, init?: RequestInit) {
    return this.http.request(this.path(query), init)
  }

  contentResponse(fileId: string, init?: RequestInit) {
    return this.http.request(`/api/v1/files/${encodeURIComponent(fileId)}/content`, init)
  }

  create(body: CreateFileRequest, init?: MutationRequestInit) {
    return this.http.json<CreateFileResponse>('/api/v1/files', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  createResponse(body: CreateFileRequest, init?: MutationRequestInit) {
    return this.http.request('/api/v1/files', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  update(body: UpdateFileRequest, init?: RequestInit) {
    return this.http.json<MutationSuccessResponse>('/api/v1/files', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  updateResponse(body: UpdateFileRequest, init?: RequestInit) {
    return this.http.request('/api/v1/files', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  deleteResponse(query: { fileId: string }, init?: RequestInit) {
    return this.http.request(this.path(query), { ...init, method: 'DELETE' })
  }

  ingestDocumentResponse(body: BodyInit, init?: RequestInit) {
    return this.http.request('/api/v1/files/ingest-document', { ...init, method: 'POST', body })
  }

  share(body: FileShareRequest, init?: RequestInit) {
    return this.http.json<FileShareResponse>('/api/v1/files/share', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  shareResponse(body: FileShareRequest, init?: RequestInit) {
    return this.http.request('/api/v1/files/share', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  uploadUrl(body: FileUploadUrlRequest, init?: RequestInit) {
    return this.http.json<FileUploadUrlResponse>(
      '/api/v1/files/upload-url',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  uploadUrlResponse(body: FileUploadUrlRequest, init?: RequestInit) {
    return this.http.request('/api/v1/files/upload-url', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  presign(query: FilePresignQuery, init?: RequestInit) {
    return this.http.json<FilePresignResponse>(
      this.http.appendQuery('/api/v1/files/presign', query as unknown as QueryParams),
      init,
    )
  }

  presignResponse(query: FilePresignQuery, init?: RequestInit) {
    return this.http.request(this.http.appendQuery('/api/v1/files/presign', query as unknown as QueryParams), init)
  }

  searchText(body: FileTextSearchRequest, init?: RequestInit) {
    return this.http.json<FileTextSearchResponse>(
      '/api/v1/files/search-text',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  searchTextResponse(body: FileTextSearchRequest, init?: RequestInit) {
    return this.http.request('/api/v1/files/search-text', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }
}
