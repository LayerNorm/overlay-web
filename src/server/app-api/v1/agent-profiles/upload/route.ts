import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({
    error: 'Hosted Overlay Cloud profile imports are retired.',
    code: 'hosted_runtime_retired',
  }, { status: 410, headers: { 'Cache-Control': 'no-store' } })
}
