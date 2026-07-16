import type {
  DeleteOutputResponse,
  OutputShareRequest,
  OutputShareResponse,
  OutputSummary,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'
import type { PaginatedEnvelope, QueryParams } from '../shared/types'
import type { OutputQuery } from './types'

export class OutputsClient {
  constructor(private readonly http: HttpContext) {}

  private path(query?: OutputQuery): string {
    return this.http.appendQuery('/api/v1/outputs', query as QueryParams | undefined)
  }

  get<T = OutputSummary[]>(query?: OutputQuery, init?: RequestInit) {
    return this.http.jsonData<T>(this.path(query), init)
  }

  getPage<T = OutputSummary>(query?: OutputQuery, init?: RequestInit) {
    return this.http.json<PaginatedEnvelope<T>>(this.path(query), init)
  }

  getResponse(query?: OutputQuery, init?: RequestInit) {
    return this.http.request(this.path(query), init)
  }

  contentResponse(outputId: string, init?: RequestInit) {
    return this.http.request(`/api/v1/outputs/${encodeURIComponent(outputId)}/content`, init)
  }

  share(body: OutputShareRequest, init?: RequestInit) {
    return this.http.json<OutputShareResponse>(
      '/api/v1/outputs',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  shareResponse(body: OutputShareRequest, init?: RequestInit) {
    return this.http.request(
      '/api/v1/outputs',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  deleteResponse(query: { outputId: string }, init?: RequestInit) {
    return this.http.request(this.path(query), { ...init, method: 'DELETE' })
  }

  parseDeleteResponse(response: Response) {
    return this.http.parseJson<DeleteOutputResponse>(response)
  }
}
