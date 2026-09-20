import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
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
    const mode = context.parsedJson.mode === 'vnc' ? 'vnc' as const : 'webrtc' as const
    const ticket = await openEnvironmentDesktop({
      workspaceId: context.workspace.workspace.id,
      environmentId: await environmentIdFrom(context),
      mode,
    })
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
