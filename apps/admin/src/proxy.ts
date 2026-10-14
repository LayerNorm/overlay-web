// Deliberate no-op proxy for the admin app. Inside this monorepo Turbopack
// also scans the repository root's src/ for convention files (proxy.ts,
// instrumentation.ts, sentry configs); this file keeps the admin app
// self-describing instead of inheriting the customer app's middleware.
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export default function proxy(_request: NextRequest) {
  return NextResponse.next()
}
