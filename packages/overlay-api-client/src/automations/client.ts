import type {
  AutomationRunSummary,
  AutomationRunRequest,
  AutomationRunResponse,
  AutomationSummary,
  AutomationTestRequest,
  AutomationTestResponse,
  CreateAutomationRequest,
  CreateAutomationResponse,
  DeleteAutomationResponse,
  UpdateAutomationRequest,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'
import type { MutationRequestInit } from '../shared/mutation'
import type { PaginatedEnvelope, QueryParams } from '../shared/types'
import type { AutomationQuery } from './types'

export class AutomationsClient {
  constructor(private readonly http: HttpContext) {}

  private path(query?: AutomationQuery): string {
    return this.http.appendQuery('/api/v1/automations', query as QueryParams | undefined)
  }

  get<T = AutomationSummary[] | AutomationSummary>(query?: AutomationQuery, init?: RequestInit) {
    return this.http.jsonData<T>(this.path(query), init)
  }

  getPage<T = AutomationSummary>(query?: AutomationQuery, init?: RequestInit) {
    return this.http.json<PaginatedEnvelope<T>>(this.path(query), init)
  }

  getResponse(query?: AutomationQuery, init?: RequestInit) {
    return this.http.request(this.path(query), init)
  }

  getRuns(automationId: string, init?: RequestInit) {
    return this.get<AutomationRunSummary[]>({ automationId, includeRuns: true }, init)
  }

  create(body: CreateAutomationRequest, init?: MutationRequestInit) {
    return this.http.json<CreateAutomationResponse>(
      '/api/v1/automations',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  createResponse(body: CreateAutomationRequest, init?: MutationRequestInit) {
    return this.http.request('/api/v1/automations', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  update(body: UpdateAutomationRequest, init?: RequestInit) {
    return this.http.json<{ success?: boolean; error?: string }>(
      '/api/v1/automations',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  updateResponse(body: UpdateAutomationRequest, init?: RequestInit) {
    return this.http.request('/api/v1/automations', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  deleteResponse(query: { automationId: string }, init?: RequestInit) {
    return this.http.request(this.path(query), { ...init, method: 'DELETE' })
  }

  parseDeleteResponse(response: Response) {
    return this.http.parseJson<DeleteAutomationResponse>(response)
  }

  run(body: AutomationRunRequest, init?: MutationRequestInit) {
    return this.http.json<AutomationRunResponse>(
      '/api/v1/automations/run',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  runResponse(body: AutomationRunRequest, init?: MutationRequestInit) {
    return this.http.request('/api/v1/automations/run', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  test(body: AutomationTestRequest, init?: RequestInit) {
    return this.http.json<AutomationTestResponse>(
      '/api/v1/automations/test',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  testResponse(body: AutomationTestRequest, init?: RequestInit) {
    return this.http.request('/api/v1/automations/test', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }
}
