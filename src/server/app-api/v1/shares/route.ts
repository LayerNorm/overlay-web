import { NextResponse } from 'next/server'
import {
  WORKSPACE_SHARE_ACCESS_ROLES,
  WORKSPACE_SHARE_RESOURCE_TYPES,
  WORKSPACE_SHARE_TARGET_TYPES,
  type WorkspaceShareAccessRole,
  type WorkspaceShareResourceType,
  type WorkspaceShareTargetType,
} from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceSharingServiceError } from '@/server/sharing'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    return NextResponse.json(await getOverlayServerContext().workspaceSharingService.getResourceShares({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      resourceType: resourceType(context.parsedQuery.resourceType),
      resourceId: required(context.parsedQuery.resourceId, 'resourceId'),
    }))
  } catch (error) {
    return sharingError(error)
  }
}

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const serverContext = getOverlayServerContext()
    await serverContext.workspaceGovernanceService.assertWithinLimits({
      action: 'share.grant',
      scope: {
        workspaceId: context.workspace.workspace.id,
        principalId: context.workspace.principal.id,
        guest: context.workspace.membership.role === 'guest',
      },
    })
    const grant = await serverContext.workspaceSharingService.upsertGrant({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      resourceType: resourceType(context.parsedJson.resourceType),
      resourceId: required(context.parsedJson.resourceId, 'resourceId'),
      targetType: targetType(context.parsedJson.targetType),
      targetId: required(context.parsedJson.targetId, 'targetId'),
      accessRole: accessRole(context.parsedJson.accessRole),
      confirmRoomExpansion: context.parsedJson.confirmRoomExpansion === true,
    })
    return NextResponse.json({ grant }, { status: 201 })
  } catch (error) {
    return sharingError(error)
  }
}

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    await getOverlayServerContext().workspaceSharingService.removeGrant({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      resourceType: resourceType(context.parsedJson.resourceType),
      resourceId: required(context.parsedJson.resourceId, 'resourceId'),
      grantId: required(context.parsedJson.grantId, 'grantId'),
    })
    return NextResponse.json({ removed: true })
  } catch (error) {
    return sharingError(error)
  }
}

function resourceType(value: unknown): WorkspaceShareResourceType {
  if (typeof value === 'string' && (WORKSPACE_SHARE_RESOURCE_TYPES as readonly string[]).includes(value)) {
    return value as WorkspaceShareResourceType
  }
  throw validation('Invalid resourceType')
}

function targetType(value: unknown): WorkspaceShareTargetType {
  if (typeof value === 'string' && (WORKSPACE_SHARE_TARGET_TYPES as readonly string[]).includes(value)) {
    return value as WorkspaceShareTargetType
  }
  throw validation('Invalid targetType')
}

function accessRole(value: unknown): WorkspaceShareAccessRole {
  if (typeof value === 'string' && (WORKSPACE_SHARE_ACCESS_ROLES as readonly string[]).includes(value)) {
    return value as WorkspaceShareAccessRole
  }
  throw validation('Invalid accessRole')
}

function required(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw validation(`${field} is required`)
  return value.trim()
}

function validation(message: string) {
  return new WorkspaceSharingServiceError('validation', message)
}

function sharingError(error: unknown) {
  if (error instanceof WorkspaceServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (!(error instanceof WorkspaceSharingServiceError)) throw error
  const status = error.code === 'not_found' ? 404
    : error.code === 'forbidden' ? 403
      : error.code === 'confirmation_required' ? 409 : 400
  return NextResponse.json({ error: error.message, code: `sharing_${error.code}` }, { status })
}
