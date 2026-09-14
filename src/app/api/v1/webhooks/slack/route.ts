import { after } from 'next/server'
import { NextResponse } from 'next/server'
import { getSurfaceChat, slackConfigured } from '@/server/surfaces/chat'
import { registerSlackSurfaceHandlers } from '@/server/surfaces/slack-inbound'

let handlersRegistered = false

/**
 * Slack Events API webhook — the Slack adapter verifies the signature,
 * dedupes retries, normalizes messages, and acks inside Slack's 3s window.
 * Handlers run via `after` so the response isn't held open; the durable turn
 * itself runs as a workflow (`surfaceAgentTurnWorkflow`).
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
  return await chat.webhooks.slack(request, {
    waitUntil: (task) => after(async () => { await task }),
  })
}
