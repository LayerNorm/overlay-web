import { NextResponse } from 'next/server'
import { getOverlaySession } from '@/server/auth/session'

export async function GET(request: Request) {
  const session = await getOverlaySession(request)
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(
    { token: session.accessToken },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
