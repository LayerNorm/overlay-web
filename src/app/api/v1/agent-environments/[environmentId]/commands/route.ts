import type { BffRouteContext } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/agent-environments/[environmentId]/commands/route'

export async function GET(request: Request, context: BffRouteContext) {
  return domainService.GET(request, context)
}
