import 'server-only'

import type {
  AuthorizationDecision,
  AuthorizationSubject,
} from '@overlay/authz-contracts'
import type { AuthorizationService } from './AuthorizationService'
import type { AuthorizationRoutePolicy } from './authorization-route-policy'

export const AUTHORIZATION_ENFORCEMENT_MODES = ['observe', 'enforce'] as const

export type AuthorizationEnforcementMode =
  (typeof AUTHORIZATION_ENFORCEMENT_MODES)[number]

export type AuthorizationRouteEvaluation = {
  allowed: boolean
  decisions: AuthorizationDecision[]
  mode: AuthorizationEnforcementMode
  subject?: AuthorizationSubject
}

export async function evaluateAuthorizationRoute(args: {
  authorization: AuthorizationService
  mode: AuthorizationEnforcementMode
  policy: AuthorizationRoutePolicy
  userId: string
}): Promise<AuthorizationRouteEvaluation> {
  if (args.policy.access === 'public' || args.policy.access === 'authenticated') {
    return { allowed: true, decisions: [], mode: args.mode }
  }
  if (args.policy.access === 'internal') {
    return { allowed: false, decisions: [], mode: args.mode }
  }

  const subject = await args.authorization.resolveSubject(args.userId)
  const decisions = (args.policy.capabilities ?? []).map((capability) =>
    args.authorization.checkResolvedCapability(subject, capability),
  )
  const denied = decisions.some(({ allowed }) => !allowed)

  return {
    allowed: !denied || args.mode === 'observe',
    decisions,
    mode: args.mode,
    subject,
  }
}

export function getAuthorizationEnforcementMode(
  value = process.env.OVERLAY_AUTHORIZATION_ENFORCEMENT_MODE,
): AuthorizationEnforcementMode {
  return value?.trim().toLowerCase() === 'enforce' ? 'enforce' : 'observe'
}

export function firstDeniedCapability(
  evaluation: AuthorizationRouteEvaluation,
): AuthorizationDecision | undefined {
  return evaluation.decisions.find(({ allowed }) => !allowed)
}
