import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalAction } from '../_generated/server'

const textEncoder = new TextEncoder()

/**
 * Maximum time to wait for a user-registered webhook endpoint to respond.
 * Without this, a slow or hostile endpoint holds a Convex action open for the
 * full action timeout (~10 minutes), exhausting the delivery pipeline.
 */
const WEBHOOK_DELIVERY_TIMEOUT_MS = 30_000

function summarizeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown webhook delivery error'
  }
}

async function signPayload(secret: string, payload: string, timestamp: number): Promise<string> {
  const signedContent = `${timestamp}.${payload}`
  const signingKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    signingKey,
    textEncoder.encode(signedContent),
  )
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const runMinuteTick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now()
    await ctx.runMutation(internal.webhooks.deliveries.resetStuckDelivering, {
      now,
    })

    const deliveryIds = await ctx.runMutation(internal.webhooks.deliveries.claimDueDeliveries, {
      now,
      limit: 25,
    })

    for (const deliveryId of deliveryIds) {
      await ctx.scheduler.runAfter(0, internal.webhooks.deliveryRunner.deliverOne, {
        deliveryId,
      })
    }

    return null
  },
})

export const deliverOne = internalAction({
  args: {
    deliveryId: v.id('webhookDeliveries'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.webhooks.deliveries.getDeliveryForExecution, {
      deliveryId: args.deliveryId,
    })
    if (!job) return null

    const timestamp = Date.now()
    let response: Response
    try {
      const signature = await signPayload(job.secret, job.payloadJson, timestamp)
      response = await fetch(job.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Overlay-Event': job.eventType,
          'X-Overlay-Event-Id': job.eventId,
          'X-Overlay-Delivery-Id': String(job.deliveryId),
          'X-Overlay-Timestamp': String(timestamp),
          'X-Overlay-Signature': `sha256=${signature}`,
        },
        body: job.payloadJson,
        signal: AbortSignal.timeout(WEBHOOK_DELIVERY_TIMEOUT_MS),
      })
    } catch (error) {
      await ctx.runMutation(internal.webhooks.deliveries.markAttemptFailed, {
        deliveryId: args.deliveryId,
        error: summarizeError(error),
        now: Date.now(),
      })
      return null
    }

    if (response.ok) {
      await ctx.runMutation(internal.webhooks.deliveries.markDelivered, {
        deliveryId: args.deliveryId,
        statusCode: response.status,
        now: Date.now(),
      })
      return null
    }

    const text = await response.text().catch(() => '')
    await ctx.runMutation(internal.webhooks.deliveries.markAttemptFailed, {
      deliveryId: args.deliveryId,
      statusCode: response.status,
      error: text || `Webhook endpoint returned ${response.status}`,
      now: Date.now(),
    })
    return null
  },
})
