import type { SandboxNetworkPolicy } from '@overlay/sandbox-runtime'

export const DEFAULT_SANDBOX_RUN_MAX_EGRESS_BYTES = 10_000_000_000

const DENIED_PRIVATE_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
]

export function sandboxRunMaxEgressBytes(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.OVERLAY_SANDBOX_RUN_MAX_EGRESS_BYTES?.trim()
  if (!configured) return DEFAULT_SANDBOX_RUN_MAX_EGRESS_BYTES
  const value = Number(configured)
  return Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_SANDBOX_RUN_MAX_EGRESS_BYTES
}

export function sandboxRunNetworkPolicy(env: NodeJS.ProcessEnv = process.env): SandboxNetworkPolicy {
  const domains = Array.from(new Set(
    (env.OVERLAY_SANDBOX_RUN_ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((domain) => domain.trim())
      .filter(Boolean),
  ))

  if (domains.length === 0) return { mode: 'deny_all' }
  return {
    mode: 'allowlist',
    domains,
    deniedCidrs: DENIED_PRIVATE_CIDRS,
  }
}
