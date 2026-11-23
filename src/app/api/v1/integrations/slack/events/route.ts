import { after, NextResponse } from 'next/server'
import { slackAppConfig } from '@/server/integrations/slack/slack-app'
import { getSlackBot } from '@/server/integrations/slack/slack-bot'
import { registerSlackHandlers } from '@/server/integrations/slack/slack-inbound'

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
    registered = true
  }
  return await bot.webhooks.slack(request, {
    waitUntil: (task) => after(async () => { await task }),
  })
}
