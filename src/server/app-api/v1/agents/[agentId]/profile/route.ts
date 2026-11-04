import { NextResponse } from 'next/server'
import { z } from 'zod/v3'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceAgentServiceError } from '@/server/agents'
import { AgentProfileError } from '@/server/agents/profiles/agent-profile-codec'
import { logger } from '@/server/observability/logger'
import { agentErrorResponse } from '../../shared'

const NO_STORE = { 'Cache-Control': 'no-store' }

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('discard'), profileId: z.string().min(1).max(64) }).strict(),
  z.object({ action: z.literal('delete_secret'), name: z.string().min(1).max(64) }).strict(),
])

async function agentIdOf(context: AppApiRouteContext) {
  const params = await context.params
  const agentId = typeof params.agentId === 'string' ? params.agentId.trim() : ''
  if (!agentId) throw new WorkspaceAgentServiceError('validation', 'Agent ID is required')
  return agentId
}

function failure(error: unknown) {
  if (error instanceof AgentProfileError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode, headers: NO_STORE })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'That request is not valid.', code: 'validation' }, { status: 400, headers: NO_STORE })
  }
  if (!(error instanceof WorkspaceAgentServiceError)) logger.error('[agent-profile] request failed', { error: error instanceof Error ? error.name : 'unknown' })
  return agentErrorResponse(error)
}

/** The agent's imported config: its versions, what each needs, and the values it still lacks. Never returns a secret value. */
export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const state = await getOverlayServerContext().agentProfiles.state({
      actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id, agentId: await agentIdOf(context),
    })
    return NextResponse.json(state, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

/** Remove historical profile data or secret values. New profile imports, applications, and secret writes are retired. */
export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const input = actionSchema.parse(context.parsedJson)
    const profiles = getOverlayServerContext().agentProfiles
    const base = { actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id, agentId: await agentIdOf(context) }
    switch (input.action) {
      case 'discard':
        await profiles.discard({ ...base, profileId: input.profileId })
        return NextResponse.json({ ok: true }, { headers: NO_STORE })
      case 'delete_secret':
        await profiles.deleteSecret({ ...base, name: input.name })
        return NextResponse.json({ ok: true }, { headers: NO_STORE })
    }
  } catch (error) {
    if (error instanceof z.ZodError && (error.issues[0]?.path[0] === 'action'
      || ['import_code', 'apply', 'hooks', 'set_secret'].includes(String((context.parsedJson as { action?: unknown } | undefined)?.action)))) {
      return NextResponse.json({
        error: 'Hosted Overlay Cloud profile import and application are retired.',
        code: 'hosted_runtime_retired',
      }, { status: 410, headers: NO_STORE })
    }
    return failure(error)
  }
}
