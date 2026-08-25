import { handleBffRoute, type BffDomainService, type BffRouteContext } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/agent-environments/[environmentId]/approve/route'

export async function POST(request: Request, context: BffRouteContext) {
  return handleBffRoute(request as never, context, domainService.POST as BffDomainService)
}
