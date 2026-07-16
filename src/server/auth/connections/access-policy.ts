import type { OverlayBetterAuthAccessPolicy } from '@/shared/config'

export type BetterAuthAccessPolicyDenial =
  | 'email_unverified'
  | 'email_domain_not_allowed'

export type BetterAuthAccessPolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: BetterAuthAccessPolicyDenial }

export interface BetterAuthIdentity {
  email: string
  emailVerified: boolean
}

export function evaluateBetterAuthAccessPolicy(
  identity: BetterAuthIdentity,
  policy: OverlayBetterAuthAccessPolicy,
): BetterAuthAccessPolicyDecision {
  if (policy.requireVerifiedEmail && !identity.emailVerified) {
    return { allowed: false, reason: 'email_unverified' }
  }

  const emailDomain = domainFromEmail(identity.email)
  const allowedDomains = new Set(
    policy.allowedEmailDomains.map((domain) => domain.trim().toLowerCase()),
  )
  if (!emailDomain || !allowedDomains.has(emailDomain)) {
    return { allowed: false, reason: 'email_domain_not_allowed' }
  }

  return { allowed: true }
}

function domainFromEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase()
  const separator = normalized.lastIndexOf('@')
  if (separator <= 0 || separator === normalized.length - 1) return null
  return normalized.slice(separator + 1)
}
