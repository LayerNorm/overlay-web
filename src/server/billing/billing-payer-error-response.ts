import 'server-only'

import { NextResponse } from 'next/server'
import { BillingPayerResolutionError } from './BillingPayerResolver'

const WORKSPACE_BILLING_REQUIRED_MESSAGE =
  'Workspace billing is required to continue. Subscribe or add usage credit in Billing.'

/**
 * A paid request in a workspace that cannot pay (no wallet, inactive account, or
 * a member who may not spend it) is a billing refusal, not a server failure.
 * Returns null for every other error so callers keep their own handling.
 */
export function billingPayerErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof BillingPayerResolutionError)) return null
  if (error.code === 'workspace_wallet_forbidden') {
    return NextResponse.json(
      { error: 'workspace_wallet_forbidden', message: 'You are not allowed to use this workspace’s billing.' },
      { status: 403 },
    )
  }
  return NextResponse.json(
    { error: 'workspace_billing_required', reason: error.code, message: WORKSPACE_BILLING_REQUIRED_MESSAGE },
    { status: 402 },
  )
}
