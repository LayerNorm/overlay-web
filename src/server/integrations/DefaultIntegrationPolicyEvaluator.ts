import 'server-only'

import type { IntegrationPolicyEvaluator } from './contracts'

export class DefaultIntegrationPolicyEvaluator implements IntegrationPolicyEvaluator {
  evaluate(args: Parameters<IntegrationPolicyEvaluator['evaluate']>[0]) {
    if (args.operation === 'disconnect' && !args.capabilities.supportsDisconnect) {
      return { allowed: false, requiresApproval: false, reason: 'Provider does not support disconnect' }
    }
    if (args.operation === 'execute' && args.requiresApproval && !args.capabilities.supportsApprovals) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: 'This tool requires approval, but the selected provider cannot complete approvals',
      }
    }
    return {
      allowed: true,
      requiresApproval: args.operation === 'execute' && args.requiresApproval === true,
    }
  }
}
