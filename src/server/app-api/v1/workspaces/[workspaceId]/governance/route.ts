import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { requiredWorkspaceParam, requiredString, validation } from '@/server/app-api/v1/workspaces/inputs'

const VIEWS = ['metrics', 'identities', 'audit-exports', 'retention'] as const
type GovernanceView = (typeof VIEWS)[number]

/** Read side of workspace governance: metrics, identities, exports, retention. */
export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const service = getOverlayServerContext().workspaceGovernanceService
    const view = parseView(context.parsedQuery.view)
    const args = { actorUserId: context.auth.userId, workspaceId }
    if (view === 'identities') {
      return NextResponse.json({
        identities: await service.listDirectoryIdentities({
          ...args,
          includeDeprovisioned: context.parsedQuery.includeDeprovisioned === '1',
        }),
      })
    }
    if (view === 'audit-exports') {
      return NextResponse.json({ exports: await service.listAuditExports(args) })
    }
    if (view === 'retention') {
      return NextResponse.json({ retention: await service.resolveRetention(args) })
    }
    return NextResponse.json({ metrics: await service.collectMetrics(args) })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to load workspace governance data')
  }
}

/**
 * Write side: link or deprovision a directory identity. Identity mapping never
 * confers a role — membership changes stay explicit.
 */
export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const service = getOverlayServerContext().workspaceGovernanceService
    const action = requiredString(context.parsedJson, 'action')
    const directory = requiredString(context.parsedJson, 'directory', { maxLength: 60 })
    const externalId = requiredString(context.parsedJson, 'externalId', { maxLength: 200 })
    if (action === 'deprovision-identity') {
      return NextResponse.json({
        identity: await service.deprovisionDirectoryIdentity({
          actorUserId: context.auth.userId,
          workspaceId,
          directory,
          externalId,
        }),
      })
    }
    if (action !== 'link-identity') throw validation('action is invalid')
    const groups = Array.isArray(context.parsedJson.externalGroupIds)
      ? context.parsedJson.externalGroupIds.filter((value): value is string => typeof value === 'string')
      : undefined
    return NextResponse.json({
      identity: await service.linkDirectoryIdentity({
        actorUserId: context.auth.userId,
        workspaceId,
        principalId: requiredString(context.parsedJson, 'principalId'),
        directory,
        externalId,
        externalGroupIds: groups,
      }),
    }, { status: 201 })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to update workspace governance')
  }
}

function parseView(value: unknown): GovernanceView {
  return typeof value === 'string' && (VIEWS as readonly string[]).includes(value)
    ? value as GovernanceView
    : 'metrics'
}
