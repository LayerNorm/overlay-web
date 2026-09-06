import { NextResponse } from 'next/server'
import {
  WORKSPACE_AGENT_VISIBILITIES,
  type WorkspaceAgentCreateInput,
  type WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentErrorResponse } from './shared'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    return NextResponse.json(await getOverlayServerContext().workspaceAgentService.list({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
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
      },
    })
    return NextResponse.json({ agent }, { status: 201 })
  } catch (error) {
    return agentErrorResponse(error)
  }
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
