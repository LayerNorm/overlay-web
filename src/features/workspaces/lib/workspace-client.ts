import type {
  WorkspaceActivateResponse,
  WorkspaceClient,
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceListResponse,
  WorkspaceManagementClient,
  WorkspaceManagementLoader,
} from '../types'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.json()
      .then((value) => {
        if (!value || typeof value !== 'object') return null
        const record = value as Record<string, unknown>
        return typeof record.error === 'string'
          ? record.error
          : typeof record.message === 'string'
            ? record.message
            : null
      })
      .catch(() => null)
    throw new Error(detail ?? `Workspace request failed (${response.status})`)
  }
  return await response.json() as T
}

export const workspaceClient: WorkspaceClient = {
  async list(signal) {
    return await readJson<WorkspaceListResponse>(await fetch('/api/v1/workspaces', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    }))
  },

  async create(input: WorkspaceCreateInput) {
    return await readJson<WorkspaceCreateResponse>(await fetch('/api/v1/workspaces', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }))
  },

  async activate(workspaceId: string) {
    return await readJson<WorkspaceActivateResponse>(await fetch('/api/v1/workspaces/active', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    }))
  },
}

export const workspaceManagementLoader: WorkspaceManagementLoader = {
  async load(workspaceId, tab, signal) {
    const query = new URLSearchParams({ view: tab })
    return await readJson(await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/management?${query.toString()}`,
      {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId },
        signal,
      },
    ))
  },
}

async function workspaceMutation<T>(
  workspaceId: string,
  path: string,
  method: 'DELETE' | 'PATCH' | 'POST',
  body?: unknown,
): Promise<T> {
  return await readJson<T>(await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      [ACTIVE_WORKSPACE_HEADER]: workspaceId,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }))
}

export const workspaceManagementClient: WorkspaceManagementClient = {
  ...workspaceManagementLoader,

  async invite(workspaceId, input) {
    return await workspaceMutation(
      workspaceId,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
      'POST',
      input,
    )
  },

  async resendInvitation(workspaceId, invitationId) {
    return await workspaceMutation(
      workspaceId,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
      'POST',
    )
  },

  async cancelInvitation(workspaceId, invitationId) {
    await workspaceMutation(
      workspaceId,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
      'DELETE',
    )
  },

  async updateMember(workspaceId, input) {
    return await workspaceMutation(
      workspaceId,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`,
      'PATCH',
      input,
    )
  },

  async removeMember(workspaceId, principalId) {
    await workspaceMutation(
      workspaceId,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`,
      'DELETE',
      { principalId },
    )
  },

  async createTeam(workspaceId, input) {
    return await workspaceMutation(
      workspaceId,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/teams`,
      'POST',
      input,
    )
  },

  async archiveTeam(workspaceId, teamId) {
    await workspaceMutation(
      workspaceId,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/teams`,
      'DELETE',
      { teamId },
    )
  },

  async addTeamMember(workspaceId, teamId, principalId) {
    await workspaceMutation(
      workspaceId,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/teams/${encodeURIComponent(teamId)}/members`,
      'POST',
      { principalId },
    )
  },

  async removeTeamMember(workspaceId, teamId, principalId) {
    await workspaceMutation(
      workspaceId,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/teams/${encodeURIComponent(teamId)}/members`,
      'DELETE',
      { principalId },
    )
  },

  async archiveWorkspace(workspaceId) {
    await workspaceMutation(
      workspaceId,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/lifecycle`,
      'DELETE',
    )
  },
}
