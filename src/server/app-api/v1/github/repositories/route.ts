import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import {
  githubAppConfigured, listInstallationRepositories, type GitHubRepository,
} from '@/server/integrations/github/github-app'

/** Repositories the workspace's GitHub App installations can reach, for the thread folder picker. */
export async function GET(_request: Request, context: AppApiRouteContext) {
  const headers = { 'Cache-Control': 'no-store' }
  if (!githubAppConfigured()) return NextResponse.json({ configured: false, repositories: [] }, { headers })
  const installations = await convex.query<Array<{ installationId: number }>>('integrations/githubInstallations:listByServer', {
    serverSecret: getInternalApiSecret(), workspaceId: context.workspace.workspace.id,
  }, { throwOnError: true }) ?? []
  const repositories: GitHubRepository[] = []
  for (const installation of installations.slice(0, 10)) {
    try {
      repositories.push(...await listInstallationRepositories(installation.installationId))
    } catch (error) {
      logger.warn('[github] listing repositories failed', { installationId: installation.installationId, error: error instanceof Error ? error.message : String(error) })
    }
  }
  repositories.sort((left, right) => left.repository.localeCompare(right.repository))
  return NextResponse.json({ configured: true, repositories }, { headers })
}
