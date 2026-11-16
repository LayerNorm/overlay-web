import { handleBffRoute, type BffDomainService } from '../../_utils/bff'
import * as domainService from '@/server/app-api/v1/github/repositories/route'

export async function GET(request: Request) {
  return handleBffRoute(request as never, {}, domainService.GET as BffDomainService)
}
