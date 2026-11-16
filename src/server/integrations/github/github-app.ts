import 'server-only'

import { createHmac, createSign, timingSafeEqual } from 'node:crypto'

/**
 * Overlay's GitHub App (internal/develop/thread-folders.md). People install it on GitHub and choose repositories;
 * each agent run gets an installation token for one repository that expires on its own within an hour. Overlay
 * keeps no long-lived GitHub credential: the app's private key only signs short app tokens on the server.
 *
 * Settings: GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY (PEM, newlines may be written as \n),
 * GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET. The app's callback URL is <origin>/api/v1/github/callback; it
 * does not request user authorization during installation, because connecting is a separate sign-in that returns to
 * whichever deployment started it.
 */

const API = 'https://api.github.com'
const STATE_TTL_MS = 10 * 60_000

export class GitHubAppError extends Error {
  constructor(readonly code: 'not_configured' | 'forbidden' | 'not_found' | 'github_error', message: string) {
    super(message)
    this.name = 'GitHubAppError'
  }
}

type Config = { appId: string; slug: string; privateKey: string; clientId: string; clientSecret: string }

function config(): Config | null {
  const appId = process.env.GITHUB_APP_ID?.trim()
  const slug = process.env.GITHUB_APP_SLUG?.trim()
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim()
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim()
  return appId && slug && privateKey && clientId && clientSecret ? { appId, slug, privateKey, clientId, clientSecret } : null
}

export const githubAppConfigured = () => config() !== null

function requireConfig(): Config {
  const value = config()
  if (!value) throw new GitHubAppError('not_configured', 'The GitHub App is not set up on this Overlay server.')
  return value
}

/** A ten-minute token that identifies the app itself, signed with its private key. */
export function appJwt(now = Date.now()): string {
  const { appId, privateKey } = requireConfig()
  const issuedAt = Math.floor(now / 1000) - 30
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: issuedAt, exp: issuedAt + 540, iss: appId })}`
  const signature = createSign('RSA-SHA256').update(body).sign(privateKey).toString('base64url')
  return `${body}.${signature}`
}

async function github<T>(path: string, init: { method?: string; token: string; scheme?: 'Bearer' | 'token'; body?: unknown }): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `${init.scheme ?? 'Bearer'} ${init.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Overlay',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 404) throw new GitHubAppError('not_found', 'GitHub couldn’t find that installation or repository.')
  if (response.status === 401 || response.status === 403) throw new GitHubAppError('forbidden', 'GitHub refused the request.')
  if (!response.ok) throw new GitHubAppError('github_error', `GitHub returned ${response.status}.`)
  return await response.json() as T
}

/** A token for one installation, limited to the named repositories and to code and pull requests. */
export async function installationToken(installationId: number, repositories?: string[]): Promise<{ token: string; expiresAt: string }> {
  const result = await github<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, {
    method: 'POST', token: appJwt(),
    body: {
      ...(repositories?.length ? { repositories } : {}),
      permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' },
    },
  })
  return { token: result.token, expiresAt: result.expires_at }
}

export type GitHubRepository = { repository: string; installationId: number; private: boolean; defaultBranch: string }

export async function listInstallationRepositories(installationId: number): Promise<GitHubRepository[]> {
  const { token } = await installationToken(installationId)
  const repositories: GitHubRepository[] = []
  for (let page = 1; page <= 5; page += 1) {
    const result = await github<{ repositories: Array<{ full_name: string; private: boolean; default_branch: string }> }>(
      `/installation/repositories?per_page=100&page=${page}`, { token },
    )
    repositories.push(...result.repositories.map(entry => ({
      repository: entry.full_name, installationId, private: entry.private, defaultBranch: entry.default_branch,
    })))
    if (result.repositories.length < 100) break
  }
  return repositories
}

export async function getRepository(token: string, repository: string): Promise<{ defaultBranch: string }> {
  const result = await github<{ default_branch: string }>(`/repos/${repository}`, { token })
  return { defaultBranch: result.default_branch }
}

/** Pull requests the app opened in a repository since a time, newest first, for the run's summary card. */
export async function pullRequestsOpenedSince(token: string, repository: string, since: number): Promise<Array<{ number: number; title: string; url: string; branch: string }>> {
  const { slug } = requireConfig()
  const result = await github<Array<{ number: number; title: string; html_url: string; created_at: string; user?: { login?: string }; head?: { ref?: string } }>>(
    `/repos/${repository}/pulls?state=open&sort=created&direction=desc&per_page=20`, { token },
  )
  return result
    .filter(pull => Date.parse(pull.created_at) >= since - 60_000 && pull.user?.login === `${slug}[bot]`)
    .map(pull => ({ number: pull.number, title: pull.title, url: pull.html_url, branch: pull.head?.ref ?? '' }))
}

/** Where people install the app on their account or organization and choose its repositories. */
export function installPageUrl(): string {
  const { slug } = requireConfig()
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`
}

/**
 * Where connecting starts: GitHub asks the person to sign in and returns to `redirectUri` on this deployment (the
 * app's registered callback, or a subdomain of it when wildcard matching is on, as for PR previews).
 */
export function authorizeUrl(state: string, redirectUri: string): string {
  const { clientId } = requireConfig()
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state })
  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

export type UserInstallation = { id: number; account: { login: string; type: string }; repositorySelection?: string }

/**
 * The app's installations the signed-in GitHub user can access. Only these are connected, so nobody can connect an
 * installation they can't see on GitHub.
 */
export async function userInstallations(code: string, redirectUri: string): Promise<UserInstallation[]> {
  const { appId, clientId, clientSecret } = requireConfig()
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Overlay' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(20_000),
  })
  const result = await response.json().catch((_error) => null) as { access_token?: string } | null
  if (!response.ok || !result?.access_token) throw new GitHubAppError('forbidden', 'GitHub didn’t accept the sign-in.')
  const found: UserInstallation[] = []
  for (let page = 1; page <= 5; page += 1) {
    const listed = await github<{ installations: Array<{ id: number; app_id?: number; account?: { login?: string; type?: string } | null; repository_selection?: string }> }>(
      `/user/installations?per_page=100&page=${page}`, { token: result.access_token },
    )
    for (const entry of listed.installations) {
      if (entry.app_id !== undefined && String(entry.app_id) !== appId) continue
      found.push({
        id: entry.id,
        account: { login: entry.account?.login ?? '', type: entry.account?.type ?? 'User' },
        ...(entry.repository_selection ? { repositorySelection: entry.repository_selection } : {}),
      })
    }
    if (listed.installations.length < 100) break
  }
  return found
}

// ---- The connect state carries who started the install through GitHub and back.

export type GitHubConnectState = { userId: string; workspaceId: string; returnTo?: string }

function signingKey(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is required for GitHub connect state')
  return secret
}

export function sealGitHubConnectState(state: GitHubConnectState, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...state, expiresAt: now + STATE_TTL_MS })).toString('base64url')
  const signature = createHmac('sha256', signingKey()).update(`overlay-github-connect:v1:${payload}`).digest('base64url')
  return `${payload}.${signature}`
}

export function openGitHubConnectState(value: string | null | undefined, now = Date.now()): GitHubConnectState | null {
  if (!value) return null
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null
  const payload = value.slice(0, separator)
  const provided = Buffer.from(value.slice(separator + 1))
  const wanted = Buffer.from(createHmac('sha256', signingKey()).update(`overlay-github-connect:v1:${payload}`).digest('base64url'))
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GitHubConnectState & { expiresAt?: number }
    if (!parsed.userId || !parsed.workspaceId || !parsed.expiresAt || parsed.expiresAt < now) return null
    return { userId: parsed.userId, workspaceId: parsed.workspaceId, ...(parsed.returnTo ? { returnTo: parsed.returnTo } : {}) }
  } catch (_error) {
    return null
  }
}
