import type { NextRequest } from 'next/server'

// Allow up to 300s for the full backfill worker to run.
// The cron action calls this endpoint synchronously and waits for completion.
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const domainService = await import('@/server/app-api/v1/imports/slack/route')
  return domainService.POST_process(request)
}
