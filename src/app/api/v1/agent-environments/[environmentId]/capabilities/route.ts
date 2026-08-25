import type { BffRouteContext } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/agent-environments/[environmentId]/capabilities/route'

export async function PUT(request: Request, context: BffRouteContext) {
  return domainService.PUT(request, context)
}
