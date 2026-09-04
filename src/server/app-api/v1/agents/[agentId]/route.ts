import { NextResponse } from 'next/server'
import {
  WORKSPACE_AGENT_HARNESSES,
  WORKSPACE_AGENT_PLATFORMS,
  WORKSPACE_AGENT_VISIBILITIES,
  type WorkspaceAgentHarness,
  type WorkspaceAgentPlatform,
  type WorkspaceAgentUpdateInput,
  type WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceAgentServiceError } from '@/server/agents'
import { agentErrorResponse } from '../shared'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const agent = await getOverlayServerContext().workspaceAgentService.get({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      agentId: requiredAgentId(await context.params),
    })
    return NextResponse.json({ agent })
  } catch (error) {
    return agentErrorResponse(error)
  }
}

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as Record<string, unknown>
    const agent = await getOverlayServerContext().workspaceAgentService.update({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      agentId: requiredAgentId(await context.params),
      input: updateInput(body),
    })
    return NextResponse.json({ agent })
  } catch (error) {
    return agentErrorResponse(error)
  }
}

function updateInput(body: Record<string, unknown>): WorkspaceAgentUpdateInput {
  const input: WorkspaceAgentUpdateInput = {}
  assignString(input, body, 'name')
  assignString(input, body, 'description')
  assignString(input, body, 'instructions')
  assignString(input, body, 'modelId')
  assignString(input, body, 'avatarColor')
  assignStrings(input, body, 'allowedToolIds')
  assignStrings(input, body, 'teamIds')
  if (body.harness !== undefined) {
    if (!isHarness(body.harness)) invalid('harness')
    input.harness = body.harness
  }
  if (body.visibility !== undefined) {
    if (!isVisibility(body.visibility)) invalid('visibility')
    input.visibility = body.visibility
  }
  if (body.platforms !== undefined) {
    input.platforms = platforms(body.platforms)
  }
  return input
}

function platforms(value: unknown): WorkspaceAgentPlatform[] {
  if (!Array.isArray(value)) invalid('platforms')
  const known = WORKSPACE_AGENT_PLATFORMS as readonly string[]
  const filtered = value.filter((entry): entry is WorkspaceAgentPlatform =>
    typeof entry === 'string' && known.includes(entry))
  if (filtered.length !== value.length) invalid('platforms')
  return filtered
}

function assignString<
  Key extends 'name' | 'description' | 'instructions' | 'modelId' | 'avatarColor',
>(input: WorkspaceAgentUpdateInput, body: Record<string, unknown>, key: Key) {
  const value = body[key]
  if (value === undefined) return
  if (typeof value !== 'string') invalid(key)
  input[key] = value
}

function assignStrings<Key extends 'allowedToolIds' | 'teamIds'>(
  input: WorkspaceAgentUpdateInput,
  body: Record<string, unknown>,
  key: Key,
) {
  const value = body[key]
  if (value === undefined) return
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) invalid(key)
  input[key] = value as string[]
}

function isHarness(value: unknown): value is WorkspaceAgentHarness {
  return typeof value === 'string'
    && (WORKSPACE_AGENT_HARNESSES as readonly string[]).includes(value)
}

function isVisibility(value: unknown): value is WorkspaceAgentVisibility {
  return typeof value === 'string'
    && (WORKSPACE_AGENT_VISIBILITIES as readonly string[]).includes(value)
}

function invalid(field: string): never {
  throw new WorkspaceAgentServiceError('validation', `Invalid ${field}`)
}

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    await getOverlayServerContext().workspaceAgentService.archive({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      agentId: requiredAgentId(await context.params),
    })
    return NextResponse.json({ archived: true })
  } catch (error) {
    return agentErrorResponse(error)
  }
}

function requiredAgentId(params: Record<string, string | string[]>) {
  const value = params.agentId
  if (typeof value !== 'string' || !value.trim()) {
    throw new WorkspaceAgentServiceError('validation', 'Agent ID is required')
  }
  return value.trim()
}
