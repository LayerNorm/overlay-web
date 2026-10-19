export const maxDuration = 300

export async function POST(request: Request) {
  const domainService = await import('@/server/app-api/v1/models/overlay-free/refresh/route')
  return domainService.POST(request)
}
