import type {
  WorkspaceActivateResponse,
  WorkspaceArchiveResponse,
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceInvitationAcceptResponse,
  WorkspaceInvitationListResponse,
  WorkspaceInviteInput,
  WorkspaceInviteResponse,
  WorkspaceListResponse,
  WorkspaceManagementResponse,
  WorkspaceManagementView,
  WorkspaceMemberMutationInput,
  WorkspaceMemberMutationResponse,
  WorkspaceTeamCreateInput,
  WorkspaceTeamCreateResponse,
  WorkspaceTeamMemberMutationInput,
  WorkspaceTeamMemberMutationResponse,
} from '@overlay/workspace-contracts'
import type { HttpContext } from '../shared/http'

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

function workspaceHeaders(workspaceId: string, init?: RequestInit): Headers {
  const headers = new Headers(init?.headers)
  headers.set(WORKSPACE_HEADER, workspaceId)
  return headers
}

function workspaceInit(workspaceId: string, init?: RequestInit): RequestInit {
  return { ...init, headers: workspaceHeaders(workspaceId, init) }
}

export class WorkspacesClient {
  constructor(private readonly http: HttpContext) {}

  list(init?: RequestInit) {
    return this.http.json<WorkspaceListResponse>('/api/v1/workspaces', init)
  }

  create(body: WorkspaceCreateInput, init?: RequestInit) {
    return this.http.json<WorkspaceCreateResponse>(
      '/api/v1/workspaces',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  activate(workspaceId: string, init?: RequestInit) {
    return this.http.json<WorkspaceActivateResponse>(
      '/api/v1/workspaces/active',
      this.http.jsonRequest({ workspaceId }, { ...init, method: 'POST' }),
    )
  }

  management(workspaceId: string, view: WorkspaceManagementView, init?: RequestInit) {
    return this.http.json<WorkspaceManagementResponse>(
      this.http.appendQuery(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/management`,
        { view },
      ),
      workspaceInit(workspaceId, init),
    )
  }

  listInvitations(workspaceId: string, init?: RequestInit) {
    return this.http.json<WorkspaceInvitationListResponse>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
      workspaceInit(workspaceId, init),
    )
  }

  invite(workspaceId: string, body: WorkspaceInviteInput, init?: RequestInit) {
    return this.http.json<WorkspaceInviteResponse>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
      this.http.jsonRequest(body, {
        ...workspaceInit(workspaceId, init),
        method: 'POST',
      }),
    )
  }

  resendInvitation(workspaceId: string, invitationId: string, init?: RequestInit) {
    return this.http.json<WorkspaceInviteResponse>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
      workspaceInit(workspaceId, { ...init, method: 'POST' }),
    )
  }

  cancelInvitation(workspaceId: string, invitationId: string, init?: RequestInit) {
    return this.http.json<{ invitation: WorkspaceInviteResponse['invitation'] }>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
      workspaceInit(workspaceId, { ...init, method: 'DELETE' }),
    )
  }

  updateMember(
    workspaceId: string,
    body: WorkspaceMemberMutationInput,
    init?: RequestInit,
  ) {
    return this.http.json<WorkspaceMemberMutationResponse>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`,
      this.http.jsonRequest(body, {
        ...workspaceInit(workspaceId, init),
        method: 'PATCH',
      }),
    )
  }

  removeMember(workspaceId: string, principalId: string, init?: RequestInit) {
    return this.http.json<{ removed: boolean; principalId: string }>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`,
      this.http.jsonRequest({ principalId }, {
        ...workspaceInit(workspaceId, init),
        method: 'DELETE',
      }),
    )
  }

  createTeam(workspaceId: string, body: WorkspaceTeamCreateInput, init?: RequestInit) {
    return this.http.json<WorkspaceTeamCreateResponse>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/teams`,
      this.http.jsonRequest(body, {
        ...workspaceInit(workspaceId, init),
        method: 'POST',
      }),
    )
  }

  archiveTeam(workspaceId: string, teamId: string, init?: RequestInit) {
    return this.http.json<{ archived: boolean; teamId: string }>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/teams`,
      this.http.jsonRequest({ teamId }, {
        ...workspaceInit(workspaceId, init),
        method: 'DELETE',
      }),
    )
  }

  addTeamMember(
    workspaceId: string,
    teamId: string,
    body: WorkspaceTeamMemberMutationInput,
    init?: RequestInit,
  ) {
    return this.http.json<WorkspaceTeamMemberMutationResponse>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/teams/${encodeURIComponent(teamId)}/members`,
      this.http.jsonRequest(body, {
        ...workspaceInit(workspaceId, init),
        method: 'POST',
      }),
    )
  }

  removeTeamMember(
    workspaceId: string,
    teamId: string,
    body: WorkspaceTeamMemberMutationInput,
    init?: RequestInit,
  ) {
    return this.http.json<{ removed: boolean; principalId: string }>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/teams/${encodeURIComponent(teamId)}/members`,
      this.http.jsonRequest(body, {
        ...workspaceInit(workspaceId, init),
        method: 'DELETE',
      }),
    )
  }

  archive(workspaceId: string, init?: RequestInit) {
    return this.http.json<WorkspaceArchiveResponse>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/lifecycle`,
      workspaceInit(workspaceId, { ...init, method: 'DELETE' }),
    )
  }

  acceptInvitation(invitationId: string, init?: RequestInit) {
    return this.http.json<WorkspaceInvitationAcceptResponse>(
      `/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}/accept`,
      { ...init, method: 'POST' },
    )
  }
}
