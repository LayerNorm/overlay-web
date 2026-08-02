import { NextResponse } from 'next/server'
import {
  WORKSPACE_SHARE_RESOURCE_TYPES,
  WORKSPACE_SHARE_TARGET_TYPES,
  type WorkspaceShareResourceType,
  type WorkspaceShareTargetType,
} from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceSharingServiceError } from '@/server/sharing'

/**
 * Disclosure endpoint for the Share dialog: who a grant would newly reach, or
 * who a revocation would cut off. It never changes access.
 */
export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const service = getOverlayServerContext().workspaceSharingService
    const base = {
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      resourceType: resourceType(context.parsedQuery.resourceType),
      resourceId: required(context.parsedQuery.resourceId, 'resourceId'),
    }
    const grantId = optional(context.parsedQuery.grantId)
    const impact = grantId
      ? await service.previewRevocationImpact({ ...base, grantId })
      : await service.previewGrantImpact({
        ...base,
        targetType: targetType(context.parsedQuery.targetType),
        targetId: required(context.parsedQuery.targetId, 'targetId'),
      })
    return NextResponse.json({ impact })
  } catch (error) {
    if (!(error instanceof WorkspaceSharingServiceError)) throw error
    const status = error.code === 'not_found' ? 404 : error.code === 'forbidden' ? 403 : 400
    return NextResponse.json({ error: error.message, code: `sharing_${error.code}` }, { status })
  }
}

function resourceType(value: unknown): WorkspaceShareResourceType {
  if (typeof value === 'string' && (WORKSPACE_SHARE_RESOURCE_TYPES as readonly string[]).includes(value)) {
    return value as WorkspaceShareResourceType
  }
  throw new WorkspaceSharingServiceError('validation', 'Invalid resourceType')
}

function targetType(value: unknown): WorkspaceShareTargetType {
  if (typeof value === 'string' && (WORKSPACE_SHARE_TARGET_TYPES as readonly string[]).includes(value)) {
    return value as WorkspaceShareTargetType
  }
  throw new WorkspaceSharingServiceError('validation', 'Invalid targetType')
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WorkspaceSharingServiceError('validation', `${field} is required`)
  }
  return value.trim()
}

function optional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
