import { after, NextResponse } from 'next/server'
import { slackAppConfig } from '@/server/integrations/slack/slack-app'
import { getSlackBot } from '@/server/integrations/slack/slack-bot'
import { handleSlackTokensRevoked, registerSlackHandlers } from '@/server/integrations/slack/slack-inbound'
import { logger } from '@/server/observability/logger'
import { registerSlackActions } from '@/server/integrations/slack/slack-actions'

/**
 * Slack Events API endpoint for the Overlay Slack app (internal/develop/slack-integration.md). The Slack adapter
 * verifies Slack's signature, dedupes retries and acknowledges within Slack's three seconds; handlers continue after
 * the response, and each admitted request runs as a durable Overlay turn.
 */
let registered = false

export async function POST(request: Request) {
  if (!slackAppConfig()) return NextResponse.json({ error: 'Slack is not configured' }, { status: 503 })
  const bot = await getSlackBot()
  if (!registered) {
    registerSlackHandlers(bot)
    registerSlackActions(bot)
    registered = true
  }
  const copy = request.clone()
  const response = await bot.webhooks.slack(request, {
    waitUntil: (task) => after(async () => { await task }),
  })
  // The adapter answers 200 only after Slack's signature checked out, so the copy's body is Slack's own.
  if (response.status === 200 && (request.headers.get('content-type') ?? '').includes('application/json')) {
    after(async () => {
      await handleSlackTokensRevoked(await copy.text()).catch((error: unknown) => {
        logger.error('[slack] could not handle tokens_revoked', { reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown' })
      })
    })
  }
  return response
}
