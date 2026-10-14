import { NextRequest, NextResponse } from 'next/server'
import { getOverlaySession } from '@/server/auth/session'
import { requireOverlayCapability } from '@/server/capabilities'
import { accountPlansRetiredResponse } from '@/server/billing/http'

// An account has no credit to top up; workspace top-ups are verified by the workspace billing routes.
export async function POST(request: NextRequest) {
  const disabledCapabilityResponse = await requireOverlayCapability('billing')
  if (disabledCapabilityResponse) return disabledCapabilityResponse
  const session = await getOverlaySession(request)
  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  return accountPlansRetiredResponse()
}
