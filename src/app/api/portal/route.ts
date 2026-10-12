import { NextRequest, NextResponse } from 'next/server'
import { getOverlaySession } from '@/server/auth/session'
import { requireOverlayCapability } from '@/server/capabilities'
import { accountPlansRetiredResponse } from '@/server/billing/http'

// An account has no plan to manage; a workspace's Stripe portal opens from Workspace → Billing.
export async function POST(request: NextRequest) {
  const disabledCapabilityResponse = await requireOverlayCapability('billing')
  if (disabledCapabilityResponse) return disabledCapabilityResponse
  const session = await getOverlaySession(request)
  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  return accountPlansRetiredResponse()
}
