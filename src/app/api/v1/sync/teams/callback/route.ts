import type { NextRequest } from 'next/server'
import { finishTeamsConnect } from '@/server/app-api/v1/sync/teams/oauth-routes'

/** Microsoft admin consent redirect target; not a BFF JSON route. */
export async function GET(request: NextRequest) {
  return await finishTeamsConnect(request)
}
