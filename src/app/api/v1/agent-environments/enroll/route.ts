import * as domainService from '@/server/app-api/v1/agent-environments/enroll/route'

export async function POST(request: Request) {
  return domainService.POST(request)
}
