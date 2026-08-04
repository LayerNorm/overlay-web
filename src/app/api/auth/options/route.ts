import { connection, NextResponse } from 'next/server'
import { getAuthUiOptions } from '@/server/auth/actions'

export async function GET() {
  await connection()
  return NextResponse.json(getAuthUiOptions(), {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
