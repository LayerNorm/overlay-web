import type { BffRouteContext } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/agent-environments/[environmentId]/local-tool-calls/route'

/** The host long-polls for up to 20 seconds. */
export const maxDuration = 30

export async function GET(request: Request, context: BffRouteContext) {
  return domainService.GET(request, context)
}
