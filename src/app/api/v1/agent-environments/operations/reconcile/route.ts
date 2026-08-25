export async function POST(request: Request) {
  const domainService = await import('@/server/app-api/v1/agent-environments/operations/reconcile/route')
  return domainService.POST(request)
}
