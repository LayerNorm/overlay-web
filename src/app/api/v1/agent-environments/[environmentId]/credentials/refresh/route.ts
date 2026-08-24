import type { BffRouteContext } from '../../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/agent-environments/[environmentId]/credentials/refresh/route'

export async function POST(request: Request, context: BffRouteContext) {
  return domainService.POST(request, context)
}
