import type { NextRequest } from 'next/server'
import { finishTeamsAccountConnect } from '@/server/app-api/v1/sync/teams/oauth-routes'

/** Microsoft sign-in redirect target for a member's Teams account; not a BFF JSON route. */
export async function GET(request: NextRequest) {
  return await finishTeamsAccountConnect(request)
}
