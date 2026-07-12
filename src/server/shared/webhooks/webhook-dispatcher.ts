import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import type { WebhookEvent } from '@/shared/schemas/webhooks'
import { WebhookEventSchema } from '@/shared/schemas/webhooks'

export type WebhookDispatchResult = {
  enqueued: number
}

export class WebhookDispatcher {
  async dispatch(userId: string, event: WebhookEvent): Promise<WebhookDispatchResult> {
    const parsed = WebhookEventSchema.parse({
      ...event,
      userId: event.userId || userId,
    })

    return await getOverlayServerContext().appData.repositories.webhooks.dispatch({
      event: parsed,
      userId: parsed.userId,
    })
  }
}

export const webhookDispatcher = new WebhookDispatcher()

export async function dispatchWebhookEvent(
  userId: string,
  event: WebhookEvent,
): Promise<WebhookDispatchResult> {
  return webhookDispatcher.dispatch(userId, event)
}
