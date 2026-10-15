import { NextResponse, type NextRequest } from 'next/server'

import { clearSessionCookie } from '@/server/session'

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/sign-in', request.nextUrl.origin))
  response.headers.append('Set-Cookie', clearSessionCookie())
  return response
}
