import { NextResponse } from 'next/server'
import { getAuthUiOptions } from '@/server/auth/actions'

export async function GET() {
  return NextResponse.json(getAuthUiOptions(), {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
