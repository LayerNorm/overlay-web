import type { MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { enqueueWebhookEvent } from '../webhooks/deliveries'

export async function enqueueTerminalWebhook(ctx: MutationCtx, run: Doc<'automationRuns'>,
  outcome: { type: 'automation.finished'; conversationId?: string } | { type: 'automation.failed'; error: string },
  now: number) {
  const id = `${outcome.type}:${run._id}`
  const conversationId = outcome.type === 'automation.finished' ? outcome.conversationId ?? run.conversationId : run.conversationId
  return await enqueueWebhookEvent(ctx, {
    userId: run.userId, eventId: id, eventType: outcome.type,
    payloadJson: JSON.stringify({ id, type: outcome.type, createdAt: now, userId: run.userId,
      data: { automationId: run.automationId, runId: run._id,
        ...(conversationId ? { conversationId } : {}),
        ...(outcome.type === 'automation.failed' ? { error: outcome.error } : {}) } }),
  })
}
