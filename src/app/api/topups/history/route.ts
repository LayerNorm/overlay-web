import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { requireOverlayCapability } from '@/server/capabilities'

// An account has no top-ups of its own (credit belongs to workspaces), so its history is empty.
export async function GET(request: NextRequest) {
  const disabledCapabilityResponse = await requireOverlayCapability('billing')
  if (disabledCapabilityResponse) return disabledCapabilityResponse

  const auth = await resolveAuthenticatedAppUser(request, {})
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  return NextResponse.json({ items: [] })
}
