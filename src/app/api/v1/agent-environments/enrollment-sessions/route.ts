import { handleBffRoute, type BffDomainService } from '../../_utils/bff'
import * as domainService from '@/server/app-api/v1/agent-environments/enrollment-sessions/route'

export async function POST(request: Request) {
  return handleBffRoute(
    request as never,
    {},
    domainService.POST as BffDomainService,
    { sensitiveResponse: true },
  )
}
