import type {
  WorkspaceIdentityMapping,
  WorkspacePlatformIdentity,
  WorkspacePlatformInstallationSummary,
} from '@overlay/workspace-contracts'
import type { HttpContext } from '../shared/http'

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

function workspaceInit(workspaceId: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set(WORKSPACE_HEADER, workspaceId)
  return { ...init, headers }
}

export class SlackClient {
  constructor(private readonly http: HttpContext) {}

  listIdentities(workspaceId: string, init?: RequestInit) {
    return this.http.json<{ identities: WorkspacePlatformIdentity[] }>(
      '/api/v1/slack/identities',
      workspaceInit(workspaceId, init),
    )
  }

  linkIdentity(workspaceId: string, body: {
    principalId: string
    directory: string
    externalId: string
  }, init?: RequestInit) {
    return this.http.json<{ mapping: WorkspaceIdentityMapping }>(
      '/api/v1/slack/identities',
      this.http.jsonRequest(body, { ...workspaceInit(workspaceId, init), method: 'POST' }),
    )
  }

  unlinkIdentity(workspaceId: string, body: {
    directory: string
    externalId: string
  }, init?: RequestInit) {
    return this.http.json<{ unlinked: true }>(
      '/api/v1/slack/identities',
      this.http.jsonRequest(body, { ...workspaceInit(workspaceId, init), method: 'DELETE' }),
    )
  }

  listInstallations(workspaceId: string, init?: RequestInit) {
    return this.http.json<{ installations: WorkspacePlatformInstallationSummary[] }>(
      '/api/v1/slack/installations',
      workspaceInit(workspaceId, init),
    )
  }

  startInstall(workspaceId: string, init?: RequestInit) {
    return this.http.json<{ authorizeUrl: string }>(
      '/api/v1/slack/install',
      workspaceInit(workspaceId, init),
    )
  }
}
