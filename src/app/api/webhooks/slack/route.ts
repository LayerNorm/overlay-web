import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { getEndpointRateLimitSpecs } from '@/server/security/rate-limit-specs'
import { SlackWebhookService, slackSpikeConfigFromEnv } from '@/server/slack/SlackWebhookService'
import { buildSlackBotDeps } from '@/server/slack/slack-bot-deps'

export async function POST(request: NextRequest) {
  // Outside handleBffRoute (no Overlay session on platform webhooks), so
  // enforce explicitly. Fails open: a limiter outage must not silence the bot.
  const rateLimited = await enforceRateLimits(
    request,
    getEndpointRateLimitSpecs({
      ip: getClientIp(request),
      method: request.method,
      pathname: request.nextUrl.pathname,
      userId: 'anonymous',
    }),
  ).catch((_limitError) => null)
  if (rateLimited) return rateLimited

  const config = slackSpikeConfigFromEnv()
  const server = getOverlayServerContext()
  const service = new SlackWebhookService(buildSlackBotDeps(server))
  try {
    return await service.handleRequest(request, config)
  } catch (error) {
    logger.error('[slack-webhook] unhandled failure', { error })
    return NextResponse.json({ error: 'Slack webhook failed' }, { status: 500 })
  }
}
