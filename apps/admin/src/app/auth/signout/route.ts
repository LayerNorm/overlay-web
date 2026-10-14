import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_SESSION_COOKIE } from '@/server/session'

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(`${request.nextUrl.origin}/signin`)
  response.cookies.set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
