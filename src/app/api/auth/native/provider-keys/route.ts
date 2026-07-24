import { NextResponse } from 'next/server'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
} as const

/**
 * This route intentionally remains as a fail-closed tombstone for old desktop
 * clients. Owner-funded provider credentials are server-only and must never be
 * returned to a client, even when the caller has a valid Overlay session.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Provider credential delivery is disabled. Use server-mediated APIs.',
      code: 'provider_credentials_server_only',
    },
    { status: 410, headers: NO_STORE_HEADERS },
  )
}
