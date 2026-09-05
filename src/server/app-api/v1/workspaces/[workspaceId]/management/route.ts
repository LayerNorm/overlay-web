import { NextResponse } from 'next/server'
import {
  canManageWorkspace,
  type WorkspaceManagementItem,
  type WorkspaceManagementResponse,
  type WorkspaceManagementView,
} from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'

const MANAGEMENT_VIEWS = [
  'people',
  'teams',
  'guests',
  'roles',
  'chats-agents',
  // Sharing policy is served by /policies; the view exists so a stale client
  // asking for it receives an empty list instead of somebody else's people.
  'sharing',
] as const

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const view = parseView(context.parsedQuery.view)
    const server = getOverlayServerContext()
    const service = server.workspaceService
    let access = await service.resolveActiveWorkspace(context.auth.userId, workspaceId)
    const account = context.auth.profile ?? (
      await server.appData.repositories.users.listDirectory()
    ).find((user) => user.id === context.auth.userId)
    if (account) {
      const principal = await service.syncHumanPrincipalProfile({
        userId: context.auth.userId,
        workspaceId,
        displayName: 'displayName' in account ? account.displayName : account.name,
        email: account.email,
      })
      access = { ...access, principal }
    }
    const canManage = canManageWorkspace(access.membership.role)
    const response = (items: WorkspaceManagementItem[]): WorkspaceManagementResponse => ({
      canManage,
      currentPrincipalId: access.principal.id,
      currentRole: access.membership.role,
      items,
      workspaceKind: access.workspace.kind,
    })

    if (view === 'sharing') return NextResponse.json(response([]))

    if (view === 'teams') {
      const teams = await service.listTeams({
        actorUserId: context.auth.userId,
        workspaceId,
      })
      return NextResponse.json(response(
        teams.map(({ team, members }) => ({
          id: team.id,
          kind: 'team',
          name: team.name,
          description: team.description ?? 'Workspace team',
          detail: `${members.length} ${members.length === 1 ? 'member' : 'members'}`,
          teamMemberPrincipalIds: members.map((member) => member.principalId),
        })),
      ))
    }

    if (view === 'guests') {
      const [members, resourceGuests, invitations] = await Promise.all([
        service.listMembers({ actorUserId: context.auth.userId, workspaceId }),
        canManage
          ? service.listResourceGuests({ actorUserId: context.auth.userId, workspaceId })
          : Promise.resolve([]),
        canManage
          ? service.listInvitations({ actorUserId: context.auth.userId, workspaceId })
          : Promise.resolve([]),
      ])
      const activeGrantsByPrincipal = new Map<string, number>()
      for (const grant of resourceGuests) {
        if (grant.status !== 'active') continue
        activeGrantsByPrincipal.set(
          grant.principalId,
          (activeGrantsByPrincipal.get(grant.principalId) ?? 0) + 1,
        )
      }
      return NextResponse.json(response([
        ...members
          .filter(({ membership }) => membership.role === 'guest')
          .map(({ principal, membership }) => {
            const grants = activeGrantsByPrincipal.get(principal.id) ?? 0
            return {
              id: principal.id,
              kind: 'member' as const,
              name: principal.displayName,
              description: principal.email ?? 'Workspace guest',
              detail: `${grants} ${grants === 1 ? 'resource' : 'resources'}`,
              badge: membership.status,
              principalId: principal.id,
              principalType: principal.type,
              role: membership.role,
              status: membership.status,
            }
          }),
        ...invitations
          .filter((invitation) => invitation.role === 'guest' && invitation.status === 'pending')
          .map((invitation) => ({
            id: invitation.id,
            kind: 'invitation' as const,
            name: invitation.email,
            description: 'Pending workspace invitation',
            detail: invitation.status,
            badge: invitation.status,
            invitationId: invitation.id,
            role: invitation.role,
            status: invitation.status,
          })),
      ]))
    }

    const members = await service.listMembers({
      actorUserId: context.auth.userId,
      workspaceId,
    })

    if (view === 'roles') {
      const roles = ['owner', 'admin', 'member', 'guest'] as const
      const descriptions = {
        owner: 'Full control, ownership transfer, and workspace archive',
        admin: 'Manage people, invitations, teams, guests, and policy',
        member: 'Create and collaborate in workspace resources',
        guest: 'Access only explicitly shared rooms and resources',
      } as const
      return NextResponse.json(response(
        roles.map((role) => {
          const count = members.filter(({ membership }) => membership.role === role).length
          return {
            id: role,
            kind: 'role' as const,
            name: role[0]!.toUpperCase() + role.slice(1),
            description: descriptions[role],
            detail: `${count} ${count === 1 ? 'principal' : 'principals'}`,
            badge: 'built-in',
          }
        }),
      ))
    }

    if (view === 'chats-agents') {
      return NextResponse.json(response(
        members
          .filter(({ principal }) => principal.type === 'agent')
          .map(({ principal, membership }) => ({
            id: principal.id,
            kind: 'member' as const,
            name: principal.displayName,
            description: 'Named workspace agent',
            detail: membership.role,
            badge: principal.type,
            principalId: principal.id,
            principalType: principal.type,
            role: membership.role,
            status: membership.status,
          })),
      ))
    }

    const invitations = canManage
      ? await service.listInvitations({ actorUserId: context.auth.userId, workspaceId })
      : []
    return NextResponse.json(response([
      ...members
        .filter(({ principal, membership }) => (
          principal.type === 'human' && membership.role !== 'guest'
        ))
        .map(({ principal, membership }) => ({
          id: principal.id,
          kind: 'member' as const,
          name: principal.displayName,
          description: principal.email ?? 'Workspace member',
          detail: membership.role,
          badge: membership.status,
          principalId: principal.id,
          principalType: principal.type,
          role: membership.role,
          status: membership.status,
        })),
      ...invitations
        .filter((invitation) => invitation.role !== 'guest' && invitation.status === 'pending')
        .map((invitation) => ({
          id: invitation.id,
          kind: 'invitation' as const,
          name: invitation.email,
          description: 'Pending workspace invitation',
          detail: invitation.role,
          badge: invitation.status,
          invitationId: invitation.id,
          role: invitation.role,
          status: invitation.status,
        })),
    ]))
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to load workspace management data')
  }
}

function parseView(value: unknown): WorkspaceManagementView {
  if (
    typeof value !== 'string'
    || !MANAGEMENT_VIEWS.includes(value as (typeof MANAGEMENT_VIEWS)[number])
  ) {
    return 'people'
  }
  return value as WorkspaceManagementView
}
