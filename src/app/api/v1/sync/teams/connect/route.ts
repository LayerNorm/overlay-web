import type { NextRequest } from 'next/server'
import { startTeamsConnect } from '@/server/app-api/v1/sync/teams/oauth-routes'

/** Browser navigation that starts Microsoft admin consent; not a BFF JSON route. */
export async function GET(request: NextRequest) {
  return await startTeamsConnect(request)
}
