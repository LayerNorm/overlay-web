import 'server-only'

import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import type { WorkspaceAgentRepository } from './WorkspaceAgentRepository'
import { WorkspaceAgentServiceError, color, optional, required, shape } from './workspace-agent-validation'

type ResolveActiveWorkspace = (
  actorUserId: string,
  workspaceId: string,
) => Promise<{ principal: { id: string }; workspace: { id: string } }>
type WorkspaceResolver = { resolveActiveWorkspace: ResolveActiveWorkspace }

export async function applyChiefIdentityUpdate(
  repository: WorkspaceAgentRepository,
  workspaces: WorkspaceResolver,
  now: () => number,
  args: {
    actorUserId: string
    workspaceId: string
    agentId: string
    updatedByPrincipalId: string
    name?: string
    description?: string
    avatarColor?: string
    avatarShape?: WorkspaceAgentDirectoryItem['avatarShape']
  },
): Promise<void> {
  const access = await workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
  if (access.principal.id !== args.updatedByPrincipalId) {
    throw new WorkspaceAgentServiceError('forbidden', 'Only the personal chief owner can change its identity')
  }
  await repository.ensureChiefs({
    workspaceId: access.workspace.id,
    actorUserId: args.actorUserId,
    actorPrincipalId: access.principal.id,
    now: now(),
  })
  const agent = await repository.get({ workspaceId: access.workspace.id, agentId: args.agentId })
  if (!agent || agent.agentRole !== 'personal_chief' || agent.chiefOwnerUserId !== args.actorUserId) {
    throw new WorkspaceAgentServiceError('forbidden', 'Only the personal chief owner can change its identity')
  }
  await repository.updateChiefIdentity({
    ownerUserId: agent.chiefOwnerUserId,
    updatedByPrincipalId: args.updatedByPrincipalId,
    ...(args.name === undefined ? {} : { name: required(args.name, 'Chief name', 80) }),
    ...(args.description === undefined ? {} : { description: optional(args.description, 240) ?? '' }),
    ...(args.avatarColor === undefined ? {} : { avatarColor: color(args.avatarColor) }),
    ...(args.avatarShape === undefined ? {} : { avatarShape: shape(args.avatarShape) }),
    now: now(),
  })
}
