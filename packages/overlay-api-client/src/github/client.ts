import type { HttpContext } from '../shared/http'

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

export type GitHubRepositoryResource = { repository: string; installationId: number; private: boolean; defaultBranch: string }

function workspaceInit(workspaceId: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set(WORKSPACE_HEADER, workspaceId)
  return { ...init, headers }
}

/** Repositories from the GitHub App installations connected to a workspace (internal/develop/thread-folders.md). */
export class GitHubClient {
  constructor(private readonly http: HttpContext) {}

  repositories(workspaceId: string, init?: RequestInit) {
    return this.http.json<{ configured: boolean; repositories: GitHubRepositoryResource[] }>(
      '/api/v1/github/repositories', workspaceInit(workspaceId, init),
    )
  }

  /** The browser address that signs in with GitHub, connects the app's installations and comes back to `returnTo`. */
  connectUrl(workspaceId: string, returnTo: string): string {
    const params = new URLSearchParams({ workspaceId, returnTo })
    return `/api/v1/github/connect?${params.toString()}`
  }

  /** The browser address of the GitHub App's install page, where people choose an account and its repositories. */
  installUrl(): string {
    return '/api/v1/github/connect?install=1'
  }
}
