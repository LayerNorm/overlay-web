import type { NextRequest } from 'next/server'
import { startTeamsAccountConnect } from '@/server/app-api/v1/sync/teams/oauth-routes'

/** Browser navigation that starts a member's Microsoft sign-in for replying as themselves; not a BFF JSON route. */
export async function GET(request: NextRequest) {
  return await startTeamsAccountConnect(request)
}
