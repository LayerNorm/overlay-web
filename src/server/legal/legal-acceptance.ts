import 'server-only'

import { getClientIp } from '@/server/security/rate-limit'
import {
  isCurrentLegalAcceptance,
  LEGAL_DOCUMENTS,
  type LegalAcceptancePayload,
} from '@/shared/legal/legal-documents'

export class LegalAcceptanceError extends Error {
  readonly statusCode = 400

  constructor() {
    super('You must accept the current Terms of Service and Privacy Policy to continue.')
    this.name = 'LegalAcceptanceError'
  }
}

export function requireCurrentLegalAcceptance(value: unknown): LegalAcceptancePayload {
  if (!isCurrentLegalAcceptance(value)) throw new LegalAcceptanceError()
  return value
}

export function legalAcceptanceMetadata(acceptance: LegalAcceptancePayload) {
  return {
    termsVersion: acceptance.termsVersion,
    privacyVersion: acceptance.privacyVersion,
    termsUrl: LEGAL_DOCUMENTS.terms.href,
    privacyUrl: LEGAL_DOCUMENTS.privacy.href,
    legalDocumentsCommit: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || 'local-or-unknown',
  }
}

export async function recordLegalAcceptance(args: {
  acceptance: LegalAcceptancePayload
  context: 'password_signup' | 'sso_signup' | 'subscription_checkout' | 'topup_checkout' | 'workspace_subscription_checkout' | 'workspace_topup_checkout'
  request: Request
  userId: string
  workspaceId?: string
}) {
  // Keep the bootstrap import lazy: billing services import the validation and
  // metadata helpers above while the bootstrap itself constructs those services.
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  const metadata = legalAcceptanceMetadata(args.acceptance)
  await getOverlayServerContext().auditService.record({
    action: 'legal.acceptance.recorded',
    actorType: 'user',
    actorUserId: args.userId,
    ipAddress: getClientIp(args.request),
    metadata: {
      ...metadata,
      acceptanceContext: args.context,
      userAgent: args.request.headers.get('user-agent')?.slice(0, 500) || undefined,
    },
    outcome: 'success',
    resourceId: args.workspaceId ?? args.userId,
    resourceType: args.workspaceId ? 'workspace_legal_acceptance' : 'user_legal_acceptance',
  })
  return metadata
}
