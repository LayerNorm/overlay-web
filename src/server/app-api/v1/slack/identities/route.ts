import { NextResponse } from 'next/server'
import type {
  WorkspacePlatformIdentity,
} from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { requiredString, validation } from '@/server/app-api/v1/workspaces/inputs'
import { PLATFORM_AGENT_DIRECTORIES } from '@/server/agents/PlatformAgentAccess'
import { decryptPlatformToken } from '@/server/slack/slack-token-crypto'
import {
  buildPlatformIdentities,
  createSlackProfileFetcher,
  type SlackProfile,
} from '@/server/slack/slack-identity-display'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const server = getOverlayServerContext()
    const workspaceId = context.workspace.workspace.id
    const actorUserId = context.auth.userId
    const mappings = await server.workspaceGovernanceService.listDirectoryIdentities({
      actorUserId,
      workspaceId,
      includeDeprovisioned: true,
    })
    const response: { identities: WorkspacePlatformIdentity[] } = {
      identities: await buildPlatformIdentities(mappings, {
        resolvePrincipalName: async (principalId: string) => (
          (await server.workspaceService.resolvePrincipal(principalId))?.displayName ?? null
        ),
        fetchSlackProfiles: await slackProfileFetcher(server, actorUserId, workspaceId),
      }),
    }
    return NextResponse.json(response)
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to load linked identities')
  }
}

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as Record<string, unknown>
    const mapping = await getOverlayServerContext().workspaceGovernanceService.linkDirectoryIdentity({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      principalId: requiredString(body, 'principalId'),
      directory: platformDirectory(body),
      externalId: requiredString(body, 'externalId'),
    })
    return NextResponse.json({ mapping }, { status: 201 })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to link identity')
  }
}

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as Record<string, unknown>
    await getOverlayServerContext().workspaceGovernanceService.unlinkDirectoryIdentity({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      directory: platformDirectory(body),
      externalId: requiredString(body, 'externalId'),
    })
    return NextResponse.json({ unlinked: true })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to unlink identity')
  }
}

function platformDirectory(body: Record<string, unknown>): string {
  const directory = requiredString(body, 'directory')
  if (!(PLATFORM_AGENT_DIRECTORIES as readonly string[]).includes(directory)) {
    throw validation('directory must be a supported chat platform')
  }
  return directory
}

/**
 * Best-effort Slack display names: any install token in the workspace can
 * resolve `users.info` for its team. No installs (or no key) means raw ids —
 * the list still succeeds.
 */
async function slackProfileFetcher(
  server: ReturnType<typeof getOverlayServerContext>,
  actorUserId: string,
  workspaceId: string,
): Promise<(externalIds: string[]) => Promise<Map<string, SlackProfile>>> {
  const empty = async () => new Map<string, SlackProfile>()
  try {
    const installs = await server.workspaceGovernanceService.listPlatformInstallations({
      actorUserId,
      workspaceId,
    })
    const slackInstall = installs.find((install) => install.directory === 'slack')
    const key = process.env.SLACK_ENCRYPTION_KEY?.trim()
    if (!slackInstall || !key) return empty
    const botToken = decryptPlatformToken({ cipher: slackInstall.botTokenCipher, keyBase64: key })
    return createSlackProfileFetcher({ botToken })
  } catch (_lookupError) {
    void _lookupError
    return empty
  }
}
