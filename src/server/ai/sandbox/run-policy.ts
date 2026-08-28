import type { SandboxNetworkPolicy } from '@overlay/sandbox-runtime'

export function sandboxRunNetworkPolicy(): SandboxNetworkPolicy {
  // The standalone execution API cannot enforce an exact byte quota at the
  // provider firewall. Keep egress disabled so its preflight reservation is a
  // true upper bound. Networked agent sandboxes use separately metered flows.
  return { mode: 'deny_all' }
}
