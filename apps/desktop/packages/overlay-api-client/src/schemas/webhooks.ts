import { z } from 'zod'
import { AuthFields } from './common'

export const WEBHOOK_EVENT_TYPES = [
  'chat.completed',
  'chat.failed',
  'automation.finished',
  'automation.failed',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

export const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES)

export const WebhookEventSchema = z.object({
  id: z.string().min(1),
  type: WebhookEventTypeSchema,
  createdAt: z.number().int().nonnegative(),
  userId: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
})

export type WebhookEvent = z.infer<typeof WebhookEventSchema>

export const WebhookSubscriptionCreateSchema = z.object({
  url: z.string().url(),
  events: z.array(WebhookEventTypeSchema).min(1),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
})

export type WebhookSubscriptionCreate = z.infer<typeof WebhookSubscriptionCreateSchema>

export const WebhookSubscriptionListQuery = z.object({
  ...AuthFields,
}).passthrough()

export const CreateWebhookSubscriptionRequest = WebhookSubscriptionCreateSchema.extend({
  ...AuthFields,
}).passthrough()

export const UpdateWebhookSubscriptionRequest = z.object({
  ...AuthFields,
  subscriptionId: z.string().min(1),
  url: z.string().url().optional(),
  events: z.array(WebhookEventTypeSchema).min(1).optional(),
  description: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
}).passthrough()

export const DeleteWebhookSubscriptionRequest = z.object({
  ...AuthFields,
  subscriptionId: z.string().min(1),
})
