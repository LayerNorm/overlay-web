import 'server-only'

import { z } from 'zod'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type { ResourceViewer } from '@/shared/workspaces/resource-scope'
import type { AgentBinding, AgentEnvironment, AgentRemoteSession, WorkspaceAccess, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import type { ConnectedAgentRepository } from './ConnectedAgentRepository'
import type { WorkspaceAgentRepository } from './WorkspaceAgentRepository'
import { assertCurrentDriveRun, type AgentDriveTokenClaims } from './agent-drive-token'

const billingSchema = z.object({ userId: z.string(), workspaceId: z.string(), agentId: z.string(), runId: z.string() })

function validAccess(access: WorkspaceAccess, claims: AgentDriveTokenClaims): boolean {
  return access.workspace.id === claims.scope.workspaceId && access.principal.workspaceId === claims.scope.workspaceId
    && access.principal.userId === claims.actorUserId && access.principal.type === 'human'
    && access.membership.workspaceId === claims.scope.workspaceId && access.membership.principalId === access.principal.id
}

function validBinding(workspaceId: string, session: AgentRemoteSession, environment: AgentEnvironment, binding: AgentBinding, agent: WorkspaceAgentDirectoryItem): boolean {
  return !agent.archivedAt && session.workspaceId === workspaceId && agent.workspaceId === workspaceId
    && environment.workspaceId === workspaceId && binding.workspaceId === workspaceId
    && binding.agentId === agent.id && binding.environmentId === environment.id
    && (environment.kind === 'overlay_cloud' || binding.adapterConfig.connectedAgentDrive === true)
}

/** Re-read persisted authority on every operation. Mutating Convex commits must repeat these checks atomically. */
export class AgentDriveAuthorization {
  constructor(private readonly dependencies: {
    enabled(): boolean
    verifyToken(token: string | null): AgentDriveTokenClaims | null
    connected: Pick<ConnectedAgentRepository, 'getRemoteSessionForRun' | 'getEnvironment' | 'listBindings'>
    agents: Pick<WorkspaceAgentRepository, 'get'>
    workspaces: Pick<WorkspaceService, 'resolveActiveWorkspace'>
    now?: () => number
  }) {}

  async authorize(token: string | null): Promise<{ claims: AgentDriveTokenClaims; viewer: ResourceViewer }> {
    if (!this.dependencies.enabled()) throw Error('DRIVE_DISABLED')
    const claims = this.dependencies.verifyToken(token)
    if (!claims) throw Error('DRIVE_UNAUTHORIZED')
    const workspaceId = claims.scope.workspaceId
    const [session, environment, bindings, agent, access] = await Promise.all([
      this.dependencies.connected.getRemoteSessionForRun({ workspaceId, environmentId: claims.environmentId, runId: claims.runId }),
      this.dependencies.connected.getEnvironment({ workspaceId, environmentId: claims.environmentId }),
      this.dependencies.connected.listBindings({ workspaceId, agentId: claims.agentId }),
      this.dependencies.agents.get({ workspaceId, agentId: claims.agentId }),
      this.dependencies.workspaces.resolveActiveWorkspace(claims.actorUserId, workspaceId),
    ])
    const binding = bindings.find(value => value.id === claims.bindingId)
    if (!session || !environment || !binding || !agent || !validAccess(access, claims)
      || !validBinding(workspaceId, session, environment, binding, agent)) throw Error('DRIVE_RUN_UNAVAILABLE')
    const billing = billingSchema.safeParse(session.capabilitySnapshot.billing)
    if (!billing.success || billing.data.workspaceId !== workspaceId) throw Error('DRIVE_RUN_UNAVAILABLE')
    const creatorOnly = agent.visibility === 'creator'
    if (creatorOnly && agent.createdByPrincipalId !== access.principal.id) throw Error('DRIVE_RUN_UNAVAILABLE')
    const scope: AgentDriveTokenClaims['scope'] = creatorOnly
      ? { kind: 'personal', workspaceId, ownerUserId: claims.actorUserId }
      : { kind: 'workspace', workspaceId }
    const hardDeadlineAt = session.hardDeadlineAt ?? session.capabilitySnapshot.hardExpiresAt
    if (typeof hardDeadlineAt !== 'number' || !Number.isSafeInteger(hardDeadlineAt)) throw Error('DRIVE_RUN_UNAVAILABLE')
    assertCurrentDriveRun(claims, {
      actorUserId: billing.data.userId, agentId: billing.data.agentId, runId: billing.data.runId,
      sessionId: session.id, bindingId: session.bindingId, environmentId: session.environmentId,
      scope, bindingEnabled: binding.enabled,
      environmentRevoked: environment.status === 'revoked' || environment.status === 'pending',
      actorIsMember: access.membership.status === 'active' && ['owner', 'admin', 'member'].includes(access.membership.role),
      status: session.status, hardDeadlineAt,
      ...(session.attemptId !== undefined && session.executionGeneration !== undefined
        ? { execution: { attemptId: session.attemptId, generation: session.executionGeneration } } : {}),
    }, this.dependencies.now?.() ?? Date.now())
    return { claims, viewer: { userId: claims.actorUserId, role: access.membership.role } }
  }
}
