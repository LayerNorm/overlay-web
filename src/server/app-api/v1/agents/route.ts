import { NextResponse } from 'next/server'
import {
  WORKSPACE_AGENT_PLATFORMS,
  WORKSPACE_AGENT_VISIBILITIES,
  type WorkspaceAgentCreateInput,
  type WorkspaceAgentPlatform,
  type WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceAgentServiceError } from '@/server/agents/WorkspaceAgentService'
import { agentErrorResponse } from './shared'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const includeArchived = context.parsedQuery.includeArchived === '1'
      || context.parsedQuery.includeArchived === 'true'
    return NextResponse.json(await getOverlayServerContext().workspaceAgentService.list({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      includeArchived,
    }))
  } catch (error) {
    return agentErrorResponse(error)
  }
}

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as Partial<WorkspaceAgentCreateInput>
    const agent = await getOverlayServerContext().workspaceAgentService.create({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      input: {
        name: typeof body.name === 'string' ? body.name : '',
        description: typeof body.description === 'string' ? body.description : undefined,
        instructions: typeof body.instructions === 'string' ? body.instructions : '',
        harness: body.harness,
        modelId: typeof body.modelId === 'string' ? body.modelId : '',
        avatarColor: typeof body.avatarColor === 'string' ? body.avatarColor : undefined,
        allowedToolIds: strings(body.allowedToolIds),
        teamIds: strings(body.teamIds),
        visibility: visibility(body.visibility),
        platforms: platforms(body.platforms),
      },
    })
    return NextResponse.json({ agent }, { status: 201 })
  } catch (error) {
    return agentErrorResponse(error)
  }
}

function platforms(value: unknown): WorkspaceAgentPlatform[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new WorkspaceAgentServiceError('validation', 'Invalid platforms')
  }
  const known = WORKSPACE_AGENT_PLATFORMS as readonly string[]
  const filtered = value.filter((entry): entry is WorkspaceAgentPlatform =>
    typeof entry === 'string' && known.includes(entry))
  if (filtered.length !== value.length) {
    throw new WorkspaceAgentServiceError('validation', 'Invalid platforms')
  }
  return filtered
}

function visibility(value: unknown): WorkspaceAgentVisibility | undefined {
  return typeof value === 'string'
    && (WORKSPACE_AGENT_VISIBILITIES as readonly string[]).includes(value)
    ? (value as WorkspaceAgentVisibility)
    : undefined
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
