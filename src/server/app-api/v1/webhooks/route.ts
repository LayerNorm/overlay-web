import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { validatePublicNetworkUrl } from '@/server/security/ssrf'
import {
  CreateWebhookSubscriptionRequest,
  WEBHOOK_EVENT_TYPES,
} from '@/shared/schemas/webhooks'
import type { Id } from '../../../../../convex/_generated/dataModel'

async function validateWebhookUrl(url: unknown): Promise<string | null> {
  const result = await validatePublicNetworkUrl(url, { allowLocalDev: true, requireHttps: true })
  return result.ok ? null : result.error
}

function parseEvents(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const allowed = new Set<string>(WEBHOOK_EVENT_TYPES)
  const events = value.filter((event): event is string => typeof event === 'string' && allowed.has(event))
  return events.length > 0 ? events : null
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const subscriptions = await convex.query('webhooks/subscriptions:list', {
      userId: auth.userId,
      serverSecret,
    })
    return NextResponse.json(subscriptions || [])
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to fetch webhook subscriptions' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json()
    const { auth } = context
    const serverSecret = getInternalApiSecret()

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

    const created = await convex.mutation('webhooks/subscriptions:create', {
      userId: auth.userId,
      serverSecret,
      url: parsed.data.url,
      events,
      description: parsed.data.description,
      enabled: parsed.data.enabled,
    }, { throwOnError: true }) as { id: Id<'webhookSubscriptions'>; secret: string }

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
    const serverSecret = getInternalApiSecret()

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

    const result = await convex.mutation('webhooks/subscriptions:update', {
      userId: auth.userId,
      serverSecret,
      subscriptionId: subscriptionId as Id<'webhookSubscriptions'>,
      url: typeof url === 'string' ? url : undefined,
      events: normalizedEvents,
      description: typeof description === 'string' ? description : undefined,
      enabled: typeof enabled === 'boolean' ? enabled : undefined,
    }, { throwOnError: true }) as { updated: boolean }

    if (!result.updated) {
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
    const serverSecret = getInternalApiSecret()

    const subscriptionId = request.nextUrl.searchParams.get('subscriptionId')
      || (typeof body === 'object' && body && 'subscriptionId' in body
        ? String((body as { subscriptionId?: string }).subscriptionId || '')
        : '')
    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId required' }, { status: 400 })
    }

    const result = await convex.mutation('webhooks/subscriptions:remove', {
      userId: auth.userId,
      serverSecret,
      subscriptionId: subscriptionId as Id<'webhookSubscriptions'>,
    }, { throwOnError: true }) as { removed: boolean }

    if (!result.removed) {
      return NextResponse.json({ error: 'Webhook subscription not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[webhooks] delete failed', error)
    return NextResponse.json({ error: 'Failed to delete webhook subscription' }, { status: 500 })
  }
}
