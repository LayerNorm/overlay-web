import 'server-only'

import type { WebhookEvent, WebhookEventType } from '@/shared/schemas/webhooks'

export type WebhookSubscriptionRecord = {
  _id: string
  createdAt: number
  description?: string
  enabled: boolean
  events: WebhookEventType[]
  updatedAt: number
  url: string
}

export type WebhookDeliveryStatus =
  | 'pending'
  | 'delivering'
  | 'delivered'
  | 'failed'
  | 'dead_letter'

export type WebhookDeliveryAttemptRecord = {
  attemptNumber: number
  completedAt?: number
  error?: string
  startedAt: number
  status: string
  statusCode?: number
}

export type WebhookDeliveryRecord = {
  _id: string
  attemptCount: number
  attempts: WebhookDeliveryAttemptRecord[]
  createdAt: number
  deliveredAt?: number
  eventId: string
  eventType: string
  lastError?: string
  lastStatusCode?: number
  status: WebhookDeliveryStatus
  subscriptionId: string
  updatedAt: number
}

export interface WebhookRepository {
  list(args: { userId: string; workspaceId?: string }): Promise<WebhookSubscriptionRecord[]>
  create(args: {
    description?: string
    enabled?: boolean
    events: WebhookEventType[]
    url: string
    userId: string
    workspaceId?: string
  }): Promise<{ id: string; secret: string }>
  update(args: {
    description?: string
    enabled?: boolean
    events?: WebhookEventType[]
    subscriptionId: string
    url?: string
    userId: string
  }): Promise<boolean>
  rotateSecret(args: { subscriptionId: string; userId: string }): Promise<string | null>
  remove(args: { subscriptionId: string; userId: string }): Promise<boolean>
  listDeliveries(args: {
    limit?: number
    subscriptionId?: string
    userId: string
    workspaceId?: string
  }): Promise<WebhookDeliveryRecord[]>
  redriveDelivery(args: { deliveryId: string; userId: string }): Promise<string | null>
  dispatch(args: { event: WebhookEvent; userId: string }): Promise<{ enqueued: number }>
}
