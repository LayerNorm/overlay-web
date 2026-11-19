import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { teamsAppPackage } from '@/server/sync/teams/app-package'
import { microsoftSyncCredentials, teamsSyncConfigured } from '@/server/sync/teams/graph'
import { getBaseUrl } from '@/server/web/app-url'
import { canManageSync, syncErrorResponse, syncJson } from '../../shared'

/**
 * GET /api/v1/sync/teams/app-package — the Overlay Teams app as a zip
 * (manifest.json and icons) for a Teams admin to upload, then add to the teams
 * whose channels should sync. It contains only public app ids, no secrets.
 */
export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  if (!canManageSync(context)) return syncErrorResponse(new Error('SYNC_MANAGE_DENIED'), 'teams')
  if (!teamsSyncConfigured()) return syncJson({ error: 'Teams sync is not configured on this deployment.', code: 'teams_not_configured' }, 503)
  const zip = teamsAppPackage({ clientId: microsoftSyncCredentials().clientId, baseUrl: getBaseUrl() })
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="overlay-teams-app.zip"',
      'Cache-Control': 'no-store',
    },
  })
}
