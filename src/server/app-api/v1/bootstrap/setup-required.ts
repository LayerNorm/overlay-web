import { NextResponse } from 'next/server'
import { BillingPayerResolutionError } from '@/server/billing/BillingPayerResolver'

export function workspaceSetupResponse(error: unknown, authType: string | undefined) {
  if (authType !== 'access-token' || !(error instanceof BillingPayerResolutionError)
    || error.code !== 'workspace_wallet_not_configured') return null
  return NextResponse.json({ error: 'Workspace setup required', code: 'workspace_setup_required' }, { status: 409 })
}
