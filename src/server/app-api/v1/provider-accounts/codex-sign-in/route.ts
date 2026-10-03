import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { AgentProviderAccountError } from '@/server/agents/provider-accounts/AgentProviderAccountService'
import { logger } from '@/server/observability/logger'

const NO_STORE = { 'Cache-Control': 'no-store' }

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }).strict(),
  z.object({
    action: z.literal('poll'),
    deviceAuthId: z.string().min(1).max(300),
    userCode: z.string().min(1).max(64),
    label: z.string().max(80).optional(),
    /** Reconnect this Codex account instead of adding a new one. */
    accountId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  }).strict(),
])

/**
 * Sign in to Codex with ChatGPT (device code). `start` returns the code and link to show; `poll` is called until the
 * person has approved, then stores the sign-in in the vault as an account. No token ever reaches the browser.
 */
export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const input = bodySchema.parse(context.parsedJson)
    const accounts = getOverlayServerContext().agentProviderAccounts
    if (input.action === 'start') {
      return NextResponse.json(await accounts.startCodexSignIn(), { status: 201, headers: NO_STORE })
    }
    const result = await accounts.completeCodexSignIn({
      userId: context.auth.userId,
      deviceAuthId: input.deviceAuthId,
      userCode: input.userCode,
      ...(input.label ? { label: input.label } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
    })
    return NextResponse.json(result, { status: result.status === 'connected' ? 201 : 200, headers: NO_STORE })
  } catch (error) {
    if (error instanceof AgentProviderAccountError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode, headers: NO_STORE })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'That request is not valid.', code: 'validation_error' }, { status: 400, headers: NO_STORE })
    }
    // Tokens are never in an error message or a log line.
    logger.error('[codex-sign-in] request failed', { detail: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ error: 'Could not complete the request', code: 'internal_error' }, { status: 500, headers: NO_STORE })
  }
}
