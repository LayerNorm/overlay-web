import type {
  WebhookEventType,
  WebhookSubscriptionCreate,
} from '../schemas/webhooks'
import type { HttpContext } from '../shared/http'

export type WebhookSubscription = {
  _id: string
  createdAt: number
  description?: string
  enabled: boolean
  events: WebhookEventType[]
  updatedAt: number
  url: string
}

export type WebhookDelivery = {
  _id: string
  attemptCount: number
  attempts: Array<{
    attemptNumber: number
    completedAt?: number
    error?: string
    startedAt: number
    status: string
    statusCode?: number
  }>
  createdAt: number
  deliveredAt?: number
  eventId: string
  eventType: string
  lastError?: string
  lastStatusCode?: number
  status: 'pending' | 'delivering' | 'delivered' | 'failed' | 'dead_letter'
  subscriptionId: string
  updatedAt: number
}

export class WebhooksClient {
  constructor(private readonly http: HttpContext) {}

  list(init?: RequestInit) {
    return this.http.jsonData<WebhookSubscription[]>('/api/v1/webhooks', init)
  }

  listResponse(init?: RequestInit) {
    return this.http.request('/api/v1/webhooks', init)
  }

  listDeliveries(query: { subscriptionId?: string; limit?: number } = {}, init?: RequestInit) {
    const path = this.http.appendQuery('/api/v1/webhooks', {
      view: 'deliveries',
      ...query,
    })
    return this.http.jsonData<WebhookDelivery[]>(path, init)
  }

  listDeliveriesResponse(query: { subscriptionId?: string; limit?: number } = {}, init?: RequestInit) {
    const path = this.http.appendQuery('/api/v1/webhooks', {
      view: 'deliveries',
      ...query,
    })
    return this.http.request(path, init)
  }

  createResponse(body: WebhookSubscriptionCreate, init?: RequestInit) {
    return this.http.request(
      '/api/v1/webhooks',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  parseCreateResponse(response: Response) {
    return this.http.parseJsonData<{ id: string; secret: string }>(response)
  }

  updateResponse(body: {
    subscriptionId: string
    description?: string
    enabled?: boolean
    events?: WebhookEventType[]
    url?: string
  }, init?: RequestInit) {
    return this.http.request(
      '/api/v1/webhooks',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  rotateSecretResponse(subscriptionId: string, init?: RequestInit) {
    return this.http.request(
      '/api/v1/webhooks',
      this.http.jsonRequest({ action: 'rotate-secret', subscriptionId }, { ...init, method: 'PATCH' }),
    )
  }

  parseRotateSecretResponse(response: Response) {
    return this.http.parseJsonData<{ secret: string }>(response)
  }

  redriveResponse(deliveryId: string, init?: RequestInit) {
    return this.http.request(
      '/api/v1/webhooks',
      this.http.jsonRequest({ action: 'redrive', deliveryId }, { ...init, method: 'PATCH' }),
    )
  }

  deleteResponse(subscriptionId: string, init?: RequestInit) {
    const path = this.http.appendQuery('/api/v1/webhooks', { subscriptionId })
    return this.http.request(path, { ...init, method: 'DELETE' })
  }
}
