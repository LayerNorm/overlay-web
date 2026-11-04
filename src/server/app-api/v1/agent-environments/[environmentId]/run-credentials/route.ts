import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({
    error: 'Hosted runtime credential delivery is retired.',
    code: 'hosted_runtime_retired',
  }, { status: 410, headers: { 'Cache-Control': 'no-store' } })
}
