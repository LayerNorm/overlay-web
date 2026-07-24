import type {
  ConnectedIntegrationsResponse,
  IntegrationConnectionRequest,
  IntegrationConnectionResponse,
  IntegrationSearchResponse,
  IntegrationSummary,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'
import type { QueryParams } from '../shared/types'
import type { IntegrationQuery } from './types'

export class IntegrationsClient {
  constructor(private readonly http: HttpContext) {}

  private path(query?: IntegrationQuery): string {
    return this.http.appendQuery('/api/v1/integrations', query as QueryParams | undefined)
  }

  get<T = ConnectedIntegrationsResponse | IntegrationSearchResponse | IntegrationSummary[]>(
    query?: IntegrationQuery,
    init?: RequestInit,
  ) {
    return this.http.json<T>(this.path(query), init)
  }

  getResponse(query?: IntegrationQuery, init?: RequestInit) {
    return this.http.request(this.path(query), init)
  }

  connect(body: IntegrationConnectionRequest, init?: RequestInit) {
    return this.http.json<IntegrationConnectionResponse>(
      '/api/v1/integrations',
      this.http.jsonRequest({ ...body, action: body.action ?? 'connect' }, { ...init, method: 'POST' }),
    )
  }

  connectResponse(body: IntegrationConnectionRequest, init?: RequestInit) {
    return this.http.request(
      '/api/v1/integrations',
      this.http.jsonRequest({ ...body, action: body.action ?? 'connect' }, { ...init, method: 'POST' }),
    )
  }

  disconnectResponse(toolkit: string, init?: RequestInit) {
    return this.http.request(
      '/api/v1/integrations',
      this.http.jsonRequest({ action: 'disconnect', providerKey: toolkit }, { ...init, method: 'POST' }),
    )
  }

  createResponse(body: IntegrationConnectionRequest, init?: RequestInit) {
    return this.http.request('/api/v1/integrations', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  updateResponse(body: IntegrationConnectionRequest, init?: RequestInit) {
    return this.http.request('/api/v1/integrations', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  deleteResponse(query?: IntegrationQuery, init?: RequestInit) {
    return this.http.request(this.path(query), { ...init, method: 'DELETE' })
  }
}
