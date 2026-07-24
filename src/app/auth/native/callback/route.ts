import { NextRequest, NextResponse } from 'next/server'
import { isValidNativeAuthCode, isValidNativeAuthState } from '@/server/auth/native-auth-validation'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
} as const

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const error = request.nextUrl.searchParams.get('error')
  const errorDescription = request.nextUrl.searchParams.get('error_description')

  const callback = new URL('overlay://auth/callback')
  if (error) {
    callback.searchParams.set(
      'error',
      /^[A-Za-z0-9._~-]{1,128}$/.test(error) ? error : 'authorization_failed',
    )
    if (errorDescription) {
      callback.searchParams.set('error_description', errorDescription.slice(0, 512))
    }
  } else if (isValidNativeAuthCode(code) && isValidNativeAuthState(state)) {
    callback.searchParams.set('code', code)
    callback.searchParams.set('state', state)
  } else {
    callback.searchParams.set('error', 'invalid_callback')
  }

  return NextResponse.redirect(callback, { headers: NO_STORE_HEADERS })
}
