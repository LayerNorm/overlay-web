import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(_request: Request, _context: AppApiRouteContext) {
  return NextResponse.json({
    error: 'Hosted Overlay Cloud agents are retired. Connect a user-owned Agent Host instead.',
    code: 'hosted_runtime_retired',
  }, { status: 410, headers: NO_STORE })
}
