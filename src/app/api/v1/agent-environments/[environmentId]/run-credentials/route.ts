import * as domainService from '@/server/app-api/v1/agent-environments/[environmentId]/run-credentials/route'

export async function POST() {
  return domainService.POST()
}
