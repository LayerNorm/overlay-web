import { handleBffRoute, type BffDomainService } from '../../_utils/bff'
import * as domainService from '@/server/app-api/v1/agent-environments/managed/route'

// Next.js route segment configuration must be a statically analyzable literal.
export const maxDuration = 300

export async function POST(request: Request) {
  return handleBffRoute(
    request as never,
    {},
    domainService.POST as BffDomainService,
    { sensitiveResponse: true },
  )
}
