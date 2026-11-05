import 'server-only'

import type { CapabilityCheck } from '@overlay/app-core'
import type { AuthorizationCapabilityPolicy } from './AuthorizationService'
import { CAPABILITY_FEATURE } from '@/shared/authorization/capability-features'

export function createAuthorizationCapabilityPolicy(
  capabilities: CapabilityCheck,
): AuthorizationCapabilityPolicy {
  return {
    isEnabled(capability) {
      const feature = CAPABILITY_FEATURE[capability]
      return feature ? capabilities[feature] : true
    },
  }
}
