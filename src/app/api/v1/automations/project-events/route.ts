export async function POST(request: Request) {
  const service = await import('@/server/app-api/v1/automations/project-events/route')
  return service.POST(request)
}
