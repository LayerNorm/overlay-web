import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

const REFUSALS: Record<string, { status: number; error: string }> = {
  WORKSPACE_BILLING_MANAGE_FORBIDDEN: { status: 403, error: 'Only workspace owners and admins can set spending caps.' },
  WORKSPACE_MEMBER_NOT_FOUND: { status: 404, error: 'That person is not a member of this workspace.' },
  billing_spend_limit_invalid: { status: 400, error: 'Enter a cap of $0 or more.' },
  billing_account_inactive: { status: 409, error: 'Set up billing for this workspace before setting caps.' },
}

/**
 * Owners and admins set or remove a member's monthly spending cap (`capCents: null` removes it). The cap covers
 * everything the person starts in this workspace, their automations and agents included, and renews each billing period.
 */
export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const body = context.parsedJson as { userId?: unknown; capCents?: unknown }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    const capCents = body.capCents === null ? null : Number(body.capCents)
    if (!userId || (capCents !== null && !Number.isFinite(capCents))) {
      return NextResponse.json({ error: 'userId and capCents (a number, or null to remove the cap) are required.' }, { status: 400 })
    }
    const result = await convex.mutation<{ capCents: number | null }>('billing/memberSpend:setMemberCapByServer', {
      serverSecret: getInternalApiSecret(),
      workspaceId,
      actorUserId: context.auth.userId,
      userId,
      capCents,
    }, { throwOnError: true })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const refusal = Object.entries(REFUSALS).find(([code]) => message.includes(code))?.[1]
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status })
    return NextResponse.json({ error: 'Could not update the spending cap.' }, { status: 500 })
  }
}
