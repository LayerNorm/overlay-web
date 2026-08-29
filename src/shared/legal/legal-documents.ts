export const LEGAL_EFFECTIVE_DATE = 'August 28, 2026'

export const LEGAL_DOCUMENTS = {
  terms: {
    href: '/terms',
    label: 'Terms of Service',
    version: '2026-08-28',
  },
  privacy: {
    href: '/privacy',
    label: 'Privacy Policy',
    version: '2026-08-28',
  },
} as const

export type LegalAcceptancePayload = {
  acceptedLegalTerms: true
  privacyVersion: typeof LEGAL_DOCUMENTS.privacy.version
  termsVersion: typeof LEGAL_DOCUMENTS.terms.version
}

export function currentLegalAcceptancePayload(): LegalAcceptancePayload {
  return {
    acceptedLegalTerms: true,
    privacyVersion: LEGAL_DOCUMENTS.privacy.version,
    termsVersion: LEGAL_DOCUMENTS.terms.version,
  }
}

export function isCurrentLegalAcceptance(value: unknown): value is LegalAcceptancePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return input.acceptedLegalTerms === true
    && input.termsVersion === LEGAL_DOCUMENTS.terms.version
    && input.privacyVersion === LEGAL_DOCUMENTS.privacy.version
}
