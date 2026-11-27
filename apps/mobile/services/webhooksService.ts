import { ACTIVE_WORKSPACE_HEADER, appJson } from './appApi'
import { mobileOverlayAppClient } from './overlayClient'

/**
 * Webhook subscriptions (`/api/v1/webhooks`). Reads go through the typed
 * client (it unwraps the repository's bare-array/envelope responses); writes
 * go through `appJson` because the typed client only exposes raw `Response`s
 * for mutations and the route returns flat bodies.
 */

export const WEBHOOK_EVENT_TYPES = [
  'chat.completed',
  'chat.failed',
  'automation.finished',
  'automation.failed',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

export type WebhookSubscription = {
  _id: string
  createdAt: number
  description?: string
  enabled: boolean
  events: string[]
  updatedAt: number
  url: string
}

export type WebhookDeliveryAttempt = {
  attemptNumber: number
  completedAt?: number
  error?: string
  startedAt: number
  status: string
  statusCode?: number
}

export type WebhookDelivery = {
  _id: string
  attemptCount: number
  attempts: WebhookDeliveryAttempt[]
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

export async function listWebhookSubscriptions(
  workspaceId: string,
): Promise<WebhookSubscription[]> {
  return mobileOverlayAppClient.webhooks.list({
    headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId },
  }) as Promise<WebhookSubscription[]>
}

export async function listWebhookDeliveries(
  workspaceId: string,
  input: {
    subscriptionId?: string
    limit?: number
  } = {},
): Promise<WebhookDelivery[]> {
  return mobileOverlayAppClient.webhooks.listDeliveries(input, {
    headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId },
  }) as Promise<WebhookDelivery[]>
}

export async function createWebhookSubscription(
  workspaceId: string,
  input: {
    url: string
    events: string[]
    description?: string
    enabled?: boolean
  },
): Promise<{ id: string; secret: string }> {
  return appJson<{ id: string; secret: string }>('/api/v1/webhooks', {
    workspaceId,
    method: 'POST',
    json: {
      url: input.url,
      events: input.events,
      ...(input.description ? { description: input.description } : {}),
      enabled: input.enabled ?? true,
    },
  })
}

export async function updateWebhookSubscription(
  workspaceId: string,
  input: {
    subscriptionId: string
    url?: string
    events?: string[]
    description?: string
    enabled?: boolean
  },
): Promise<void> {
  await appJson<{ success: boolean }>('/api/v1/webhooks', {
    workspaceId,
    method: 'PATCH',
    json: {
      subscriptionId: input.subscriptionId,
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.events !== undefined ? { events: input.events } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  })
}

export async function rotateWebhookSecret(
  workspaceId: string,
  subscriptionId: string,
): Promise<string> {
  const response = await appJson<{ secret: string; success: boolean }>('/api/v1/webhooks', {
    workspaceId,
    method: 'PATCH',
    json: { action: 'rotate-secret', subscriptionId },
  })
  return response.secret
}

export async function redriveWebhookDelivery(
  workspaceId: string,
  deliveryId: string,
): Promise<string> {
  const response = await appJson<{ deliveryId: string; success: boolean }>('/api/v1/webhooks', {
    workspaceId,
    method: 'PATCH',
    json: { action: 'redrive', deliveryId },
  })
  return response.deliveryId
}

export async function deleteWebhookSubscription(
  workspaceId: string,
  subscriptionId: string,
): Promise<void> {
  await appJson<{ success: boolean }>('/api/v1/webhooks', {
    workspaceId,
    method: 'DELETE',
    query: { subscriptionId },
  })
}
