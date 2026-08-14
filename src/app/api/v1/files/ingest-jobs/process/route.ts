import type { NextRequest } from 'next/server'
import * as domainService from '@/server/app-api/v1/files/ingest-jobs/process/route'

// This is an internal endpoint called by the Convex ingestion runner,
// not a BFF route. It bypasses the BFF context and uses internal API
// secret authorization directly.
export async function POST(request: NextRequest) {
  return domainService.POST(request)
}
