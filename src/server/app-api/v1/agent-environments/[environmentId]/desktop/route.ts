import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { canUseEnvironmentDesktop } from '@/server/agents/environment-desktop-access'
import {
  EnvironmentMachineError,
  openEnvironmentDesktop,
} from '@/server/agents/environment-machine'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'

/**
 * Live desktop ticket for an Overlay Cloud environment's machine — the
 * environment's box doubles as the agent's computer, so this is the same
 * surface computers use, resolved through the environment's sandbox lease.
 */
export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = context.workspace.workspace.id
    const environmentId = await environmentIdFrom(context)
    // A desktop stream is interactive control of the agent's machine: whoever may use the agent may open it (a personal
    // agent's machine is its creator's alone, a workspace agent's is the workspace's members'), not just managers.
    const server = getOverlayServerContext()
    const bound = (await server.appData.repositories.connectedAgents.listBindings({ workspaceId }))
      .filter((binding) => binding.enabled && binding.environmentId === environmentId)
    // The directory already hides a personal agent from everyone but its creator.
    const visible = bound.length > 0
      ? new Set((await server.workspaceAgentService.list({ actorUserId: context.auth.userId, workspaceId, includeArchived: true })).agents.map((agent) => agent.id))
      : new Set<string>()
    if (!canUseEnvironmentDesktop({
      role: context.workspace.membership.role,
      boundAgents: bound.length,
      visibleBoundAgents: bound.filter((binding) => visible.has(binding.agentId)).length,
    })) {
      return NextResponse.json(
        { error: 'You do not have access to this agent’s machine', code: 'agent_machine_forbidden' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const mode = context.parsedJson.mode === 'vnc' ? 'vnc' as const : 'webrtc' as const
    const ticket = await openEnvironmentDesktop({ workspaceId, environmentId, mode })
    if (!ticket.ready) {
      return NextResponse.json(
        { error: 'The desktop stream is still preparing', code: 'desktop_preparing' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    // The ticket URL is a bearer secret — never log it; the shell marks this
    // route sensitiveResponse so it is not persisted by the idempotency store.
    return NextResponse.json(
      { url: ticket.url, mode: ticket.mode, expiresAt: ticket.expiresAt ?? null },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof EnvironmentMachineError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'desktop_preparing' ? 409 : 400
      return NextResponse.json({ error: error.message, code: error.code }, {
        status,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    return agentEnvironmentErrorResponse(error)
  }
}
