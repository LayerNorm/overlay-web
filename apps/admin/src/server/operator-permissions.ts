import 'server-only'

import type { AdministrativePrincipal } from './admin/AdministrativeRepository'
import { FIXED_AUTHORIZATION_ROLE_DEFINITIONS } from './authorization/FixedRoleAuthorizationBridge'

/** Operator permissions are independent of customer workspace role assignments. */
export function operatorCapabilities(principal: AdministrativePrincipal) {
  return principal.revokedAt === undefined
    ? [...FIXED_AUTHORIZATION_ROLE_DEFINITIONS[principal.role].capabilities]
    : []
}
