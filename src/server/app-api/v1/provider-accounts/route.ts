import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { AgentProviderAccountError } from '@/server/agents/provider-accounts/AgentProviderAccountService'
import { logger } from '@/server/observability/logger'
import { isAgentProviderAuthMethod, isAgentProviderId } from '@/shared/agents/provider-accounts'

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const NO_STORE = { 'Cache-Control': 'no-store' }

function accounts() {
  return getOverlayServerContext().agentProviderAccounts
}

function errorResponse(error: unknown) {
  if (error instanceof AgentProviderAccountError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode, headers: NO_STORE })
  }
  // The credential is never in an error message or a log line.
  logger.error('[provider-accounts] request failed', { error: error instanceof Error ? error.name : 'unknown' })
  return NextResponse.json({ error: 'Could not complete the request', code: 'internal_error' }, { status: 500, headers: NO_STORE })
}

function body(context: AppApiRouteContext): Record<string, unknown> {
  const parsed = context.parsedJson
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
}

/** The person's own agent accounts. The response never includes a credential or its vault reference. */
export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const data = await accounts().list(context.auth.userId)
    return NextResponse.json({ data, hasMore: false, total: data.length }, { headers: NO_STORE })
  } catch (error) {
    return errorResponse(error)
  }
}

/** Connect an account: `{ provider, method, secret, label? }`. */
export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const input = body(context)
    if (!isAgentProviderId(input.provider) || !isAgentProviderAuthMethod(input.method)) {
      return NextResponse.json({ error: 'Choose an agent and a sign-in method', code: 'validation_error' }, { status: 400, headers: NO_STORE })
    }
    const account = await accounts().connect({
      userId: context.auth.userId,
      provider: input.provider,
      method: input.method,
      secret: input.secret,
      ...(typeof input.label === 'string' ? { label: input.label } : {}),
    })
    return NextResponse.json({ account }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return errorResponse(error)
  }
}

/** Reconnect (`{ accountId, secret }`) or rename (`{ accountId, label }`). */
export async function PATCH(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const input = body(context)
    if (typeof input.accountId !== 'string' || !ACCOUNT_ID_PATTERN.test(input.accountId)) {
      return NextResponse.json({ error: 'accountId is required', code: 'validation_error' }, { status: 400, headers: NO_STORE })
    }
    if (input.secret !== undefined) {
      const account = await accounts().reconnect({ userId: context.auth.userId, accountId: input.accountId, secret: input.secret })
      return NextResponse.json({ account }, { headers: NO_STORE })
    }
    if (typeof input.label === 'string') {
      await accounts().rename({ userId: context.auth.userId, accountId: input.accountId, label: input.label })
      return NextResponse.json({ ok: true }, { headers: NO_STORE })
    }
    return NextResponse.json({ error: 'Nothing to update', code: 'validation_error' }, { status: 400, headers: NO_STORE })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const accountId = request.nextUrl.searchParams.get('accountId')
    if (!accountId || !ACCOUNT_ID_PATTERN.test(accountId)) {
      return NextResponse.json({ error: 'accountId is required', code: 'validation_error' }, { status: 400, headers: NO_STORE })
    }
    await accounts().remove({ userId: context.auth.userId, accountId })
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  } catch (error) {
    return errorResponse(error)
  }
}
