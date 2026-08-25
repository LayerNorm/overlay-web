export async function POST(request: Request) {
  const domainService = await import('@/server/app-api/v1/agent-environments/artifacts/cleanup/route')
  return domainService.POST(request)
}
