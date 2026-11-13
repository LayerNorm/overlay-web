import { POST as maintain } from '@/server/app-api/v1/sync/teams/maintain/route'

/** Internal endpoint for the Convex Teams maintenance cron; authorized by x-internal-api-secret, not a BFF route. */
export async function POST(request: Request) {
  return await maintain(request)
}
