import { handleBffRoute, type BffDomainService, type BffRouteContext } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/agent-environments/[environmentId]/roots/route'

export async function PATCH(request: Request, context: BffRouteContext) {
  return handleBffRoute(request as never, context, domainService.PATCH as BffDomainService)
}
