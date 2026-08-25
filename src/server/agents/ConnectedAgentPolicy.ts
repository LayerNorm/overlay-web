import 'server-only'

import type { Entitlements } from '@/shared/app/app-contracts'

export type ConnectedAgentPolicyLimits = {
  maxEnvironments: number
  maxConcurrentRuns: number
  maxRunTimeMs: number
  maxEventsPerMinute: number
  maxArtifactBytes: number
  maxIdleDurationMs: number
  maxSandboxEgressBytes: number
}

const GIB = 1024 * 1024 * 1024

/** Product limits are centralized so Convex and PostgreSQL receive identical values. */
export function connectedAgentPolicyFor(entitlements: Pick<Entitlements, 'planKind' | 'tier'>): ConnectedAgentPolicyLimits {
  if (entitlements.tier === 'max') return {
    maxEnvironments: 100,
    maxConcurrentRuns: 100,
    maxRunTimeMs: 24 * 60 * 60_000,
    maxEventsPerMinute: 50_000,
    maxArtifactBytes: 100 * GIB,
    maxIdleDurationMs: 60 * 60_000,
    maxSandboxEgressBytes: 100 * GIB,
  }
  if (entitlements.planKind === 'paid' || entitlements.tier !== 'free') return {
    maxEnvironments: 10,
    maxConcurrentRuns: 10,
    maxRunTimeMs: 24 * 60 * 60_000,
    maxEventsPerMinute: 10_000,
    maxArtifactBytes: 10 * GIB,
    maxIdleDurationMs: 15 * 60_000,
    maxSandboxEgressBytes: 10 * GIB,
  }
  return {
    maxEnvironments: 1,
    maxConcurrentRuns: 1,
    maxRunTimeMs: 30 * 60_000,
    maxEventsPerMinute: 1_000,
    maxArtifactBytes: 100 * 1024 * 1024,
    maxIdleDurationMs: 5 * 60_000,
    maxSandboxEgressBytes: 0,
  }
}
