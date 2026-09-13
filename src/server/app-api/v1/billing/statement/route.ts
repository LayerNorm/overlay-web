import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { billingErrorResponse } from '@/server/billing/http'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  USAGE_STATEMENT_CATEGORIES,
  type UsageStatementCategory,
} from '@/shared/billing/usage-statement'

const FALLBACK_PERIOD_MS = 30 * 24 * 60 * 60_000

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const server = getOverlayServerContext()
    // This endpoint always reports the member's personal wallet — workspace
    // spend is itemized under /workspaces/[id]/billing/statement instead.
    const account = await server.appData.repositories.billing
      .ensurePersonalBillingAccount({ userId: context.auth.userId })
    const subscription = await server.appData.repositories.billing
      .getBillingAccountSubscriptionByServer({ billingAccountId: account.billingAccountId })
    const periodStart = subscription?.currentPeriodStart ?? Date.now() - FALLBACK_PERIOD_MS
    const periodEnd = subscription?.currentPeriodEnd

    const url = new URL(request.url)
    const category = parseCategory(url.searchParams.get('category'))
    if (category) {
      return NextResponse.json(await server.appData.repositories.usage.listUsageStatementLines({
        billingAccountId: account.billingAccountId,
        category,
        limit: parseNumber(url.searchParams.get('limit')),
        offset: parseNumber(url.searchParams.get('offset')),
        periodEnd,
        periodStart,
      }))
    }
    return NextResponse.json(await server.appData.repositories.usage.getUsageStatement({
      billingAccountId: account.billingAccountId,
      periodEnd,
      periodStart,
    }))
  } catch (error) {
    return billingErrorResponse(error, 'Failed to load usage statement.')
  }
}

function parseCategory(value: string | null): UsageStatementCategory | undefined {
  if (value === null) return undefined
  return (USAGE_STATEMENT_CATEGORIES as readonly string[]).includes(value)
    ? (value as UsageStatementCategory)
    : undefined
}

function parseNumber(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
