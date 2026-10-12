import * as domainService from '@/server/app-api/v1/agent-profiles/upload/route'

export const maxDuration = 60

export async function POST(request: Request) {
  return domainService.POST(request)
}
