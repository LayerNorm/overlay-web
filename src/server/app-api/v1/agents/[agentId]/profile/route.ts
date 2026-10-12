import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceAgentServiceError } from '@/server/agents'
import { CloudAgentMachineError } from '@/server/agents/cloud/CloudAgentMachineService'
import { AgentProfileError } from '@/server/agents/profiles/agent-profile-codec'
import { logger } from '@/server/observability/logger'
import { getAgentFacingBaseUrl } from '@/server/web/app-url'
import { agentErrorResponse } from '../../shared'

const NO_STORE = { 'Cache-Control': 'no-store' }

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('import_code'), harness: z.string().max(32) }).strict(),
  z.object({ action: z.literal('apply'), profileId: z.string().min(1).max(64), hooksEnabled: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('discard'), profileId: z.string().min(1).max(64) }).strict(),
  z.object({ action: z.literal('hooks'), profileId: z.string().min(1).max(64), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('set_secret'), name: z.string().min(1).max(64), value: z.string().min(1).max(4096) }).strict(),
  z.object({ action: z.literal('delete_secret'), name: z.string().min(1).max(64) }).strict(),
])

async function agentIdOf(context: AppApiRouteContext) {
  const params = await context.params
  const agentId = typeof params.agentId === 'string' ? params.agentId.trim() : ''
  if (!agentId) throw new WorkspaceAgentServiceError('validation', 'Agent ID is required')
  return agentId
}

function failure(error: unknown) {
  if (error instanceof AgentProfileError || error instanceof CloudAgentMachineError) {
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

/** Create an import code, apply or discard a version, turn imported hooks on or off, set or remove a needed value. */
export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const input = actionSchema.parse(context.parsedJson)
    const profiles = getOverlayServerContext().agentProfiles
    const base = { actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id, agentId: await agentIdOf(context) }
    switch (input.action) {
      case 'import_code':
        return NextResponse.json(await profiles.createImportCode({ ...base, harness: input.harness, serverUrl: getAgentFacingBaseUrl() }), { status: 201, headers: NO_STORE })
      case 'apply':
        return NextResponse.json(await profiles.apply({ ...base, profileId: input.profileId, ...(input.hooksEnabled === undefined ? {} : { hooksEnabled: input.hooksEnabled }) }), { headers: NO_STORE })
      case 'discard':
        await profiles.discard({ ...base, profileId: input.profileId })
        return NextResponse.json({ ok: true }, { headers: NO_STORE })
      case 'hooks':
        await profiles.setHooks({ ...base, profileId: input.profileId, enabled: input.enabled })
        return NextResponse.json({ ok: true }, { headers: NO_STORE })
      case 'set_secret':
        await profiles.setSecret({ ...base, name: input.name, value: input.value })
        return NextResponse.json({ ok: true }, { headers: NO_STORE })
      case 'delete_secret':
        await profiles.deleteSecret({ ...base, name: input.name })
        return NextResponse.json({ ok: true }, { headers: NO_STORE })
    }
  } catch (error) {
    return failure(error)
  }
}
