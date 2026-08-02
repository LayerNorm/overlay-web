import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'

/**
 * Immutable audit export as newline-delimited JSON. Each line is one recorded
 * event; the response is append-only history, never a mutable report.
 */
export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const { record, events } = await getOverlayServerContext().workspaceGovernanceService
      .exportAudit({
        actorUserId: context.auth.userId,
        workspaceId,
        fromRecordedAt: parseTimestamp(context.parsedQuery.from),
        limit: parseLimit(context.parsedQuery.limit),
      })
    const body = events.map((event) => JSON.stringify(event)).join('\n')
    return new NextResponse(body.length > 0 ? `${body}\n` : '', {
      status: 200,
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'content-disposition': `attachment; filename="workspace-audit-${record.id}.ndjson"`,
        'cache-control': 'no-store',
        'x-overlay-audit-export-id': record.id,
        'x-overlay-audit-event-count': String(record.eventCount),
        'x-overlay-audit-to': String(record.toRecordedAt),
      },
    })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to export workspace audit history')
  }
}

function parseTimestamp(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parseLimit(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.min(parsed, 10_000)
}
