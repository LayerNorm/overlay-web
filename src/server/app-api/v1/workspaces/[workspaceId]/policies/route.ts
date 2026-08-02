import { NextResponse } from 'next/server'
import {
  canManageWorkspace,
  WORKSPACE_AGENT_HARNESSES,
  WORKSPACE_ROLLOUT_STAGES,
  type WorkspaceRolloutStage,
  type WorkspaceSharingPolicyPatch,
  type WorkspaceSharingPolicyResponse,
} from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { requiredWorkspaceParam, validation } from '@/server/app-api/v1/workspaces/inputs'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const service = getOverlayServerContext().workspaceService
    const [access, policy] = await Promise.all([
      service.resolveActiveWorkspace(context.auth.userId, workspaceId),
      service.getSharingPolicy({ actorUserId: context.auth.userId, workspaceId }),
    ])
    return NextResponse.json({
      policy,
      canManage: canManageWorkspace(access.membership.role),
    } satisfies WorkspaceSharingPolicyResponse)
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to load workspace policy')
  }
}

const BOOLEAN_FIELDS = [
  'publicLinksEnabled',
  'memberCanCreateChannels',
  'memberCanCreateAgents',
  'memberCanInvite',
  'legalHold',
] as const

const NUMBER_FIELDS = [
  'guestExpirationDays',
  'channelRetentionDays',
  'agentRunBudgetCents',
] as const

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const policy = await getOverlayServerContext().workspaceService.setSharingPolicy({
      actorUserId: context.auth.userId,
      workspaceId,
      patch: parsePatch(context.parsedJson),
    })
    return NextResponse.json({ policy, canManage: true } satisfies WorkspaceSharingPolicyResponse)
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to update workspace policy')
  }
}

/**
 * Only recognized policy fields are accepted, and the request cannot smuggle in
 * other columns. An empty patch is rejected rather than silently doing nothing.
 */
function parsePatch(body: Record<string, unknown>): WorkspaceSharingPolicyPatch {
  const patch: WorkspaceSharingPolicyPatch = {}
  for (const field of BOOLEAN_FIELDS) {
    if (body[field] === undefined) continue
    if (typeof body[field] !== 'boolean') throw validation(`${field} must be a boolean`)
    patch[field] = body[field] as boolean
  }
  for (const field of NUMBER_FIELDS) {
    if (body[field] === undefined) continue
    if (body[field] === null) continue
    if (typeof body[field] !== 'number') throw validation(`${field} must be a number`)
    patch[field] = body[field] as number
  }
  if (body.dataResidency !== undefined) {
    if (typeof body.dataResidency !== 'string') throw validation('dataResidency must be a string')
    patch.dataResidency = body.dataResidency.trim().slice(0, 120)
  }
  if (body.rolloutStage !== undefined) {
    if (
      typeof body.rolloutStage !== 'string'
      || !(WORKSPACE_ROLLOUT_STAGES as readonly string[]).includes(body.rolloutStage)
    ) throw validation('rolloutStage is invalid')
    patch.rolloutStage = body.rolloutStage as WorkspaceRolloutStage
  }
  if (body.allowedAgentHarnesses !== undefined) {
    if (body.allowedAgentHarnesses === null) patch.allowedAgentHarnesses = []
    else {
      if (!Array.isArray(body.allowedAgentHarnesses)) {
        throw validation('allowedAgentHarnesses must be a list')
      }
      const harnesses = body.allowedAgentHarnesses.map((value) => String(value))
      if (harnesses.some((value) => !(WORKSPACE_AGENT_HARNESSES as readonly string[]).includes(value))) {
        throw validation('allowedAgentHarnesses contains an unknown runtime')
      }
      patch.allowedAgentHarnesses = harnesses as WorkspaceSharingPolicyPatch['allowedAgentHarnesses']
    }
  }
  if (Object.keys(patch).length === 0) throw validation('No policy fields were supplied')
  return patch
}
