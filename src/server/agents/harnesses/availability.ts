import 'server-only'

/**
 * Whether managed HarnessAgents are available to a workspace, and which
 * catalog entries it may pick. Three gates, all fail-closed:
 *
 *   1. Runtime features — `overlayCloudEnvironments` (the managed-sandbox
 *      surface) and `managedHarnessAgents` (the harness picker's own switch),
 *      plus provider credentials (no Vercel keys → nothing can provision).
 *   2. Rollout stage — `OVERLAY_MANAGED_HARNESS_ROLLOUT_STAGE` plus the
 *      internal/invited workspace lists, kept independent of the BYO rollout.
 *   3. Workspace policy — `allowedAgentHarnesses` filters the catalog; an
 *      empty/absent list allows everything.
 *
 * See `docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md`, Phase 3.
 */

import {
  managedHarnessRolloutConfigFromEnv,
  resolveConnectedAgentRollout,
} from '@/shared/agents/connected-agent-rollout'
import {
  MANAGED_HARNESS_CATALOG,
  type ManagedHarnessCatalogEntry,
} from '@/shared/agents/harness-catalog'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlayRuntimeConfig } from '@/server/config'
import { managedHarnessSandboxProviders } from './sandbox-providers'

export type ManagedHarnessAvailability = {
  enabled: boolean
  harnesses: ManagedHarnessCatalogEntry[]
  /** Providers the deployment can create sandboxes on, preferred first. */
  providers: string[]
}

const DISABLED: ManagedHarnessAvailability = { enabled: false, harnesses: [], providers: [] }

/**
 * The pure decision, split from `managedHarnessAvailability` so tests can
 * exercise every gate without env or repository wiring.
 */
export function managedHarnessCatalogFor(args: {
  featureEnabled: boolean
  rolloutEligible: boolean
  providers: readonly string[]
  allowedHarnesses?: readonly string[] | null
}): ManagedHarnessAvailability {
  if (!args.featureEnabled || !args.rolloutEligible || args.providers.length === 0) {
    return DISABLED
  }
  const harnesses = args.allowedHarnesses?.length
    ? MANAGED_HARNESS_CATALOG.filter((entry) => (args.allowedHarnesses as readonly string[]).includes(entry.id))
    : [...MANAGED_HARNESS_CATALOG]
  return harnesses.length > 0
    ? { enabled: true, harnesses, providers: [...args.providers] }
    : DISABLED
}

export async function managedHarnessAvailability(args: {
  actorUserId: string
  workspaceId: string
}): Promise<ManagedHarnessAvailability> {
  const config = await getOverlayRuntimeConfig()
  const rollout = resolveConnectedAgentRollout(
    managedHarnessRolloutConfigFromEnv(process.env),
    args.workspaceId,
  )
  const policy = await getOverlayServerContext().workspaceService.getSharingPolicy({
    actorUserId: args.actorUserId,
    workspaceId: args.workspaceId,
  }).catch((_error) => 'error' as const)
  // A policy lookup failure means the allowlist cannot be evaluated — closed.
  if (policy === 'error') return DISABLED
  return managedHarnessCatalogFor({
    featureEnabled: config.features.overlayCloudEnvironments === true
      && config.features.managedHarnessAgents === true,
    rolloutEligible: rollout.eligible,
    providers: managedHarnessSandboxProviders(),
    allowedHarnesses: policy?.allowedAgentHarnesses,
  })
}
