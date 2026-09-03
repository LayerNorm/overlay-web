import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceAgentServiceError } from '@/server/agents/WorkspaceAgentService'
import { mintInstallState, SlackInstallService } from '@/server/slack/SlackInstallService'

const DEFAULT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:read',
  'chat:write',
  'groups:history',
  'im:history',
  'im:read',
  'users:read',
].join(',')

/**
 * Starts a Slack install for the current workspace. Manager-gated: the signed
 * state minted here authorizes the unauthenticated OAuth callback, so only
 * owners/admins may mint it.
 */
export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const server = getOverlayServerContext()
    const access = await server.workspaceService.resolveActiveWorkspace(
      context.auth.userId,
      context.workspace.workspace.id,
    )
    if (access.membership.role !== 'owner' && access.membership.role !== 'admin') {
      throw new WorkspaceAgentServiceError('forbidden', 'Only workspace owners and admins can install the Slack bot')
    }
    const clientId = process.env.SLACK_CLIENT_ID?.trim()
    const redirectUri = process.env.SLACK_REDIRECT_URI?.trim()
    const secret = process.env.INTERNAL_API_SECRET?.trim()
    if (!clientId || !redirectUri || !secret) {
      return NextResponse.json({ error: 'Slack install is not configured' }, { status: 503 })
    }
    const service = new SlackInstallService({
      governance: server.workspaceGovernanceService,
      exchangeCode: () => { throw new Error('unreachable') },
      encryptToken: () => { throw new Error('unreachable') },
    })
    const state = mintInstallState({
      workspaceId: access.workspace.id,
      principalId: access.principal.id,
      secret,
    })
    return NextResponse.json({
      authorizeUrl: service.authorizeUrl({
        clientId,
        redirectUri,
        scopes: process.env.SLACK_SCOPES?.trim() || DEFAULT_SCOPES,
        state,
      }),
    })
  } catch (error) {
    if (error instanceof WorkspaceAgentServiceError && error.code === 'forbidden') {
      return NextResponse.json({ error: error.message, code: 'slack_forbidden' }, { status: 403 })
    }
    throw error
  }
}
