import type {
  WorkspaceInvitation,
  WorkspaceManagementItem,
  WorkspaceManagementResponse,
  WorkspaceMembershipRole,
  WorkspaceSummary,
  WorkspaceTeam,
} from '@overlay/workspace-contracts'
import type {
  WorkspaceClient,
  WorkspaceManagementClient,
  WorkspaceSettingsTab,
} from '@/features/workspaces/types'

function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace'
}

export function createShowcaseWorkspaceClient(fixtures: readonly WorkspaceSummary[]): WorkspaceClient {
  let workspaces = fixtures.map((workspace) => ({ ...workspace }))
  let activeWorkspaceId = workspaces[0]?.id
  let createdCount = 0

  return {
    async list() {
      return { workspaces, activeWorkspaceId }
    },
    async create(input) {
      createdCount += 1
      const slug = input.slug?.trim() || toSlug(input.name)
      const workspace: WorkspaceSummary = {
        id: `showcase-created-${createdCount}`,
        name: input.name.trim(),
        slug,
        kind: 'organization',
        status: 'active',
        role: 'owner',
        memberCount: 1,
      }
      workspaces = [...workspaces, workspace]
      return { workspace }
    },
    async activate(workspaceId) {
      const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
      if (!workspace) throw new Error('Workspace not found or you no longer have access.')
      activeWorkspaceId = workspace.id
      return { activeWorkspaceId, workspace }
    },
  }
}

export function createShowcaseWorkspaceManagementClient(
  fixtures: readonly WorkspaceSummary[],
): WorkspaceManagementClient {
  const workspaceById = new Map(fixtures.map((workspace) => [workspace.id, workspace]))
  const itemsByWorkspace = new Map<string, WorkspaceManagementItem[]>()
  let sequence = 0

  function items(workspaceId: string): WorkspaceManagementItem[] {
    const existing = itemsByWorkspace.get(workspaceId)
    if (existing) return existing
    const workspace = workspaceById.get(workspaceId)
    const seeded = workspace?.kind === 'personal'
      ? [memberItem(workspaceId, 'you', 'Divyansh Lalwani', 'divyansh@layernorm.co', 'owner')]
      : [
        memberItem(workspaceId, 'you', 'Divyansh Lalwani', 'divyansh@layernorm.co', workspace?.role ?? 'member'),
        memberItem(workspaceId, 'maya', 'Maya Chen', 'maya@acme.test', 'admin'),
        memberItem(workspaceId, 'jon', 'Jon Bell', 'jon@acme.test', 'member'),
        {
          id: `${workspaceId}-invite`,
          kind: 'invitation' as const,
          name: 'alex@acme.test',
          description: 'Invited 2 hours ago',
          badge: 'pending',
          status: 'pending' as const,
          invitationId: `${workspaceId}-invite`,
        },
        memberItem(workspaceId, 'guest', 'Priya Shah', 'priya@partner.test', 'guest'),
        {
          id: `${workspaceId}-team-product`,
          kind: 'team' as const,
          name: 'Product',
          description: '3 people · 1 agent',
          detail: '4 members',
          teamMemberPrincipalIds: [
            `${workspaceId}-principal-you`,
            `${workspaceId}-principal-maya`,
            `${workspaceId}-agent-research`,
          ],
        },
        {
          id: `${workspaceId}-team-support`,
          kind: 'team' as const,
          name: 'Customer support',
          description: '2 people · 1 agent',
          detail: '3 members',
          teamMemberPrincipalIds: [`${workspaceId}-principal-jon`, `${workspaceId}-agent-triage`],
        },
        {
          id: `${workspaceId}-role-member`,
          kind: 'role' as const,
          name: 'Member',
          description: 'Create and collaborate on workspace content',
          detail: 'Built in',
        },
        {
          id: `${workspaceId}-role-guest`,
          kind: 'role' as const,
          name: 'Guest',
          description: 'Only access explicitly shared resources',
          detail: 'Built in',
        },
        agentItem(workspaceId, 'research', 'Research agent', 'Sources, synthesis, and briefs'),
        agentItem(workspaceId, 'triage', 'Triage agent', 'Routes requests and proposes owners'),
      ]
    itemsByWorkspace.set(workspaceId, seeded)
    return seeded
  }

  function replaceItems(
    workspaceId: string,
    update: (current: WorkspaceManagementItem[]) => WorkspaceManagementItem[],
  ) {
    itemsByWorkspace.set(workspaceId, update(items(workspaceId)))
  }

  function response(
    workspaceId: string,
    tab: WorkspaceSettingsTab,
  ): WorkspaceManagementResponse {
    const workspace = workspaceById.get(workspaceId)
    if (!workspace) throw new Error('Workspace not found or you no longer have access.')
    const all = items(workspaceId)
    const filtered = all.filter((item) => {
      if (tab === 'people') {
        return item.kind === 'invitation'
          || (item.kind === 'member' && item.principalType === 'human' && item.role !== 'guest')
      }
      if (tab === 'teams') return item.kind === 'team'
      if (tab === 'guests') {
        return item.kind === 'member' && item.principalType === 'human' && item.role === 'guest'
      }
      if (tab === 'roles') return item.kind === 'role'
      return item.kind === 'member' && item.principalType === 'agent'
    })
    return {
      canManage: workspace.role === 'owner' || workspace.role === 'admin',
      currentPrincipalId: `${workspaceId}-principal-you`,
      currentRole: workspace.role,
      workspaceKind: workspace.kind,
      items: filtered,
    }
  }

  return {
    async load(workspaceId, tab) {
      return response(workspaceId, tab)
    },
    async invite(workspaceId, input) {
      sequence += 1
      const invitation = invitationFixture(workspaceId, input.email, input.role, sequence)
      replaceItems(workspaceId, (current) => [
        ...current.filter((item) => item.name.toLowerCase() !== input.email.toLowerCase()),
        {
          id: invitation.id,
          kind: 'invitation',
          name: invitation.email,
          description: 'Invited just now',
          badge: 'pending',
          status: 'pending',
          invitationId: invitation.id,
        },
      ])
      return { invitation, invitePath: `/app/invitations/${invitation.id}` }
    },
    async resendInvitation(workspaceId, invitationId) {
      const current = items(workspaceId).find((item) => item.invitationId === invitationId)
      if (!current) throw new Error('Invitation not found')
      sequence += 1
      const invitation = invitationFixture(
        workspaceId,
        current.name,
        'member',
        sequence,
      )
      replaceItems(workspaceId, (all) => all.map((item) => (
        item.invitationId === invitationId
          ? { ...item, id: invitation.id, invitationId: invitation.id, description: 'Resent just now' }
          : item
      )))
      return { invitation, invitePath: `/app/invitations/${invitation.id}` }
    },
    async cancelInvitation(workspaceId, invitationId) {
      replaceItems(workspaceId, (all) => all.filter((item) => item.invitationId !== invitationId))
    },
    async updateMember(workspaceId, input) {
      const target = items(workspaceId).find((item) => item.principalId === input.principalId)
      if (!target) throw new Error('Member not found')
      const role = input.action === 'set-role' ? input.role : target.role ?? 'member'
      replaceItems(workspaceId, (all) => all.map((item) => (
        item.principalId === input.principalId
          ? { ...item, role, badge: role, status: input.action === 'set-status' ? input.status : item.status }
          : item
      )))
      return {
        membership: {
          workspaceId,
          principalId: input.principalId,
          role,
          status: input.action === 'set-status' ? input.status : 'active',
          joinedAt: Date.now(),
          updatedAt: Date.now(),
        },
      }
    },
    async removeMember(workspaceId, principalId) {
      replaceItems(workspaceId, (all) => all.filter((item) => item.principalId !== principalId))
    },
    async createTeam(workspaceId, input) {
      sequence += 1
      const team: WorkspaceTeam = {
        id: `${workspaceId}-team-${sequence}`,
        workspaceId,
        name: input.name,
        description: input.description,
        createdByPrincipalId: `${workspaceId}-principal-you`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      replaceItems(workspaceId, (all) => [...all, {
        id: team.id,
        kind: 'team',
        name: team.name,
        description: team.description ?? 'No members yet',
        detail: '0 members',
        teamMemberPrincipalIds: [],
      }])
      return { team }
    },
    async archiveTeam(workspaceId, teamId) {
      replaceItems(workspaceId, (all) => all.filter((item) => item.id !== teamId))
    },
    async addTeamMember(workspaceId, teamId, principalId) {
      replaceItems(workspaceId, (all) => all.map((item) => (
        item.id === teamId
          ? {
            ...item,
            teamMemberPrincipalIds: Array.from(new Set([
              ...(item.teamMemberPrincipalIds ?? []),
              principalId,
            ])),
          }
          : item
      )))
    },
    async removeTeamMember(workspaceId, teamId, principalId) {
      replaceItems(workspaceId, (all) => all.map((item) => (
        item.id === teamId
          ? {
            ...item,
            teamMemberPrincipalIds: (item.teamMemberPrincipalIds ?? [])
              .filter((candidate) => candidate !== principalId),
          }
          : item
      )))
    },
    async archiveWorkspace(workspaceId) {
      const workspace = workspaceById.get(workspaceId)
      if (!workspace || workspace.kind === 'personal') throw new Error('Workspace cannot be archived')
      workspaceById.set(workspaceId, { ...workspace, status: 'archived' })
    },
  }
}

function memberItem(
  workspaceId: string,
  id: string,
  name: string,
  email: string,
  role: WorkspaceMembershipRole,
): WorkspaceManagementItem {
  return {
    id: `${workspaceId}-member-${id}`,
    kind: 'member',
    name,
    description: email,
    badge: role,
    principalId: `${workspaceId}-principal-${id}`,
    principalType: 'human',
    role,
    status: 'active',
  }
}

function agentItem(
  workspaceId: string,
  id: string,
  name: string,
  description: string,
): WorkspaceManagementItem {
  return {
    id: `${workspaceId}-member-agent-${id}`,
    kind: 'member',
    name,
    description,
    badge: 'agent',
    principalId: `${workspaceId}-agent-${id}`,
    principalType: 'agent',
    role: 'member',
    status: 'active',
  }
}

function invitationFixture(
  workspaceId: string,
  email: string,
  role: Exclude<WorkspaceMembershipRole, 'owner'>,
  sequence: number,
): WorkspaceInvitation {
  const now = Date.now()
  return {
    id: `${workspaceId}-invitation-${sequence}`,
    workspaceId,
    email: email.trim().toLowerCase(),
    role,
    status: 'pending',
    invitedByPrincipalId: `${workspaceId}-principal-you`,
    expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
    createdAt: now,
    updatedAt: now,
  }
}
