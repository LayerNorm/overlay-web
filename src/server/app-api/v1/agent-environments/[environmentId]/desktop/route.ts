import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'

export async function POST(_request: Request, _context: AppApiRouteContext) {
  return NextResponse.json({
    error: 'Hosted Overlay Cloud desktop access is retired.',
    code: 'hosted_runtime_retired',
  }, { status: 410, headers: { 'Cache-Control': 'no-store' } })
}
