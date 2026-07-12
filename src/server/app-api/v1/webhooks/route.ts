import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { validatePublicNetworkUrl } from '@/server/security/ssrf'
import {
  CreateWebhookSubscriptionRequest,
  WEBHOOK_EVENT_TYPES,
} from '@/shared/schemas/webhooks'
import type { WebhookEventType } from '@/shared/schemas/webhooks'

async function validateWebhookUrl(url: unknown): Promise<string | null> {
  const result = await validatePublicNetworkUrl(url, {
    allowLocalDev: process.env.NODE_ENV !== 'production',
    requireHttps: true,
  })
  return result.ok ? null : result.error
}

function parseEvents(value: unknown): WebhookEventType[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const allowed = new Set<string>(WEBHOOK_EVENT_TYPES)
  const events = value.filter((event): event is WebhookEventType =>
    typeof event === 'string' && allowed.has(event),
  )
  return events.length > 0 ? events : null
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    return NextResponse.json(await getOverlayServerContext().appData.repositories.webhooks.list({
      userId: auth.userId,
    }))
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to fetch webhook subscriptions' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json()
    const { auth } = context

    const parsed = CreateWebhookSubscriptionRequest.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid webhook subscription payload' }, { status: 400 })
    }

    const urlError = await validateWebhookUrl(parsed.data.url)
    if (urlError) {
      return NextResponse.json({ error: urlError }, { status: 400 })
    }

    const events = parseEvents(parsed.data.events)
    if (!events) {
      return NextResponse.json({ error: 'At least one supported webhook event is required' }, { status: 400 })
    }

    const created = await getOverlayServerContext().appData.repositories.webhooks.create({
      userId: auth.userId,
      url: parsed.data.url,
      events,
      description: parsed.data.description,
      enabled: parsed.data.enabled,
    })

    return NextResponse.json({
      id: created.id,
      secret: created.secret,
    })
  } catch (error) {
    logger.error('[webhooks] create failed', error)
    return NextResponse.json({ error: 'Failed to create webhook subscription' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json()
    const { auth } = context

    const {
      subscriptionId,
      url,
      events,
      description,
      enabled,
    } = body as Record<string, unknown>
    if (!subscriptionId || typeof subscriptionId !== 'string') {
      return NextResponse.json({ error: 'subscriptionId required' }, { status: 400 })
    }

    if (url !== undefined) {
      const urlError = await validateWebhookUrl(url)
      if (urlError) {
        return NextResponse.json({ error: urlError }, { status: 400 })
      }
    }

    const normalizedEvents = events === undefined ? undefined : parseEvents(events)
    if (events !== undefined && !normalizedEvents) {
      return NextResponse.json({ error: 'At least one supported webhook event is required' }, { status: 400 })
    }

    const updated = await getOverlayServerContext().appData.repositories.webhooks.update({
      userId: auth.userId,
      subscriptionId,
      url: typeof url === 'string' ? url : undefined,
      events: normalizedEvents ?? undefined,
      description: typeof description === 'string' ? description : undefined,
      enabled: typeof enabled === 'boolean' ? enabled : undefined,
    })

    if (!updated) {
      return NextResponse.json({ error: 'Webhook subscription not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[webhooks] update failed', error)
    return NextResponse.json({ error: 'Failed to update webhook subscription' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    let body: { accessToken?: string; userId?: string } = {}
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      try {
        body = await request.json()
      } catch (_error) {
        body = {}
      }
    }
    const { auth } = context

    const subscriptionId = request.nextUrl.searchParams.get('subscriptionId')
      || (typeof body === 'object' && body && 'subscriptionId' in body
        ? String((body as { subscriptionId?: string }).subscriptionId || '')
        : '')
    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId required' }, { status: 400 })
    }

    const removed = await getOverlayServerContext().appData.repositories.webhooks.remove({
      userId: auth.userId,
      subscriptionId,
    })

    if (!removed) {
      return NextResponse.json({ error: 'Webhook subscription not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[webhooks] delete failed', error)
    return NextResponse.json({ error: 'Failed to delete webhook subscription' }, { status: 500 })
  }
}
