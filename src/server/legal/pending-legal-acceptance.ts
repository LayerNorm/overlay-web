import 'server-only'

import type { LegalAcceptancePayload } from '@/shared/legal/legal-documents'
import { isCurrentLegalAcceptance } from '@/shared/legal/legal-documents'

export const PENDING_LEGAL_ACCEPTANCE_COOKIE = 'overlay_legal_acceptance_pending'

export function encodePendingLegalAcceptance(acceptance: LegalAcceptancePayload): string {
  return `${acceptance.termsVersion}.${acceptance.privacyVersion}`
}

export function decodePendingLegalAcceptance(value: string | null | undefined): LegalAcceptancePayload | null {
  if (!value) return null
  const [termsVersion, privacyVersion, extra] = value.split('.')
  if (extra !== undefined) return null
  const candidate = { acceptedLegalTerms: true, termsVersion, privacyVersion }
  return isCurrentLegalAcceptance(candidate) ? candidate : null
}
