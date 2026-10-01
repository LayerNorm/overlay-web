import { after } from 'next/server'
import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { getSurfaceChat, slackConfigured } from '@/server/surfaces/chat'
import { registerSlackSurfaceHandlers } from '@/server/surfaces/slack-inbound'
import {
  extractSlackLifecycleAction,
  verifySlackRequestSignature,
} from '@/server/surfaces/slack-lifecycle'
import { summarizeErrorForLog } from '@/shared/security/safe-log'

let handlersRegistered = false

/**
 * Slack Events API webhook — the Slack adapter verifies the signature,
 * dedupes retries, normalizes messages, and acks inside Slack's 3s window.
 * Handlers run via `after` so the response isn't held open; the durable turn
 * itself runs as a workflow (`surfaceAgentTurnWorkflow`).
 *
 * `app_uninstalled` and `tokens_revoked` aren't dispatched by the Chat SDK,
 * so the route handles them itself: parse the envelope, verify Slack's
 * signature on the raw body, then mark the matching connection non-active.
 */
export async function POST(request: Request) {
  if (!slackConfigured()) {
    return NextResponse.json({ error: 'Slack surface is not configured' }, { status: 503 })
  }
  const chat = await getSurfaceChat()
  if (!handlersRegistered) {
    registerSlackSurfaceHandlers(chat)
    handlersRegistered = true
  }

  // Clone before reading — the SDK still needs the untouched request body.
  const body = await request.clone().text()
  const action = extractSlackLifecycleAction(body)
  if (action) {
    if (
      !verifySlackRequestSignature({
        headers: request.headers,
        body,
        signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
      })
    ) {
      return NextResponse.json({ error: 'Invalid Slack signature' }, { status: 401 })
    }
    try {
      const updated = await getOverlayServerContext().surfaceService.degradeConnectionByTeam({
        platform: 'slack',
        teamId: action.teamId ?? null,
        enterpriseId: action.enterpriseId ?? null,
        status: action.type === 'app_uninstalled' ? 'uninstalled' : 'degraded',
      })
      logger.warn('[surfaces/slack] lifecycle event processed', {
        eventType: action.type,
        teamId: action.teamId,
        updated,
      })
    } catch (error) {
      // Non-200 lets Slack retry — the transition is idempotent.
      logger.error('[surfaces/slack] lifecycle event handling failed', {
        eventType: action.type,
        teamId: action.teamId,
        error: summarizeErrorForLog(error),
      })
      return NextResponse.json({ error: 'Slack lifecycle handling failed' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  return await chat.webhooks.slack(request, {
    waitUntil: (task) => after(async () => { await task }),
  })
}
