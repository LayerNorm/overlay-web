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

export interface WebhookRepository {
  list(args: { userId: string }): Promise<WebhookSubscriptionRecord[]>
  create(args: {
    description?: string
    enabled?: boolean
    events: WebhookEventType[]
    url: string
    userId: string
  }): Promise<{ id: string; secret: string }>
  update(args: {
    description?: string
    enabled?: boolean
    events?: WebhookEventType[]
    subscriptionId: string
    url?: string
    userId: string
  }): Promise<boolean>
  remove(args: { subscriptionId: string; userId: string }): Promise<boolean>
  dispatch(args: { event: WebhookEvent; userId: string }): Promise<{ enqueued: number }>
}
