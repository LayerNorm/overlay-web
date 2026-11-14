export const maxDuration = 60

export async function POST(request: Request) {
  const domainService = await import('@/server/app-api/v1/sync/outbound/route')
  return domainService.POST(request)
}
