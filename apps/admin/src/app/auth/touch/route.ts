import { NextResponse, type NextRequest } from 'next/server'

import { resolveOperator } from '@/server/operator'
import {
  ADMIN_SESSION_COOKIE,
  sealPayload,
  serializeCookie,
  SESSION_ABSOLUTE_TTL_MS,
} from '@/server/session'

/** POST keeps the idle window alive and persists refreshed WorkOS tokens. */
export async function POST(request: NextRequest) {
  const outcome = await resolveOperator(request.cookies.get(ADMIN_SESSION_COOKIE)?.value)
  if (outcome.kind === 'anonymous') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (outcome.kind === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const session = { ...outcome.session, lastActiveAt: Date.now() }
  const response = NextResponse.json({ ok: true })
  response.headers.append(
    'Set-Cookie',
    serializeCookie(ADMIN_SESSION_COOKIE, sealPayload(session), Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000)),
  )
  return response
}
