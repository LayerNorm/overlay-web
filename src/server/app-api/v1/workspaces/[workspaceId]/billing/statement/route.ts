import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { billingErrorResponse, workspaceBillingService } from '@/server/billing/http'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'
import {
  USAGE_STATEMENT_CATEGORIES,
  type UsageStatementCategory,
} from '@/shared/billing/usage-statement'

export async function GET(request: Request, context: AppApiRouteContext) {
  try {
    const url = new URL(request.url)
    return NextResponse.json(await workspaceBillingService.statement({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(await context.params, 'workspaceId'),
      category: parseCategory(url.searchParams.get('category')),
      limit: parseNumber(url.searchParams.get('limit')),
      offset: parseNumber(url.searchParams.get('offset')),
    }))
  } catch (error) {
    return billingErrorResponse(error, 'Failed to load workspace usage statement.')
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
