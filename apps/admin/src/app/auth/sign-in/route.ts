import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'

import {
  ADMIN_AUTH_STATE_COOKIE,
  AUTH_STATE_TTL_MS,
  sealPayload,
  serializeCookie,
} from '@/server/session'
import { adminAuthorizationUrl } from '@/server/workos'
import { safeReturnTo } from '@/server/auth-redirect'

type AuthState = {
  issuedAt: number
  nonce: string
  returnTo: string
}

export async function GET(request: NextRequest) {
  const state: AuthState = {
    issuedAt: Date.now(),
    nonce: randomUUID(),
    returnTo: safeReturnTo(request.nextUrl.searchParams.get('returnTo'), request.nextUrl.origin),
  }
  const url = adminAuthorizationUrl({
    origin: request.nextUrl.origin,
    state: state.nonce,
  })
  const response = NextResponse.redirect(url)
  response.headers.append(
    'Set-Cookie',
    serializeCookie(ADMIN_AUTH_STATE_COOKIE, sealPayload(state), Math.floor(AUTH_STATE_TTL_MS / 1000)),
  )
  return response
}
