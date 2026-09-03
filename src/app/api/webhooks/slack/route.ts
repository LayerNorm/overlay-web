import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { SlackWebhookService, slackSpikeConfigFromEnv } from '@/server/slack/SlackWebhookService'
import { buildSlackBotDeps } from '@/server/slack/slack-bot-deps'

export async function POST(request: Request) {
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
