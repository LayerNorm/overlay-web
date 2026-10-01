import { NextResponse } from 'next/server'
import { parseHarnessAgentBindingConfig } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { managedHarnessAvailability } from '@/server/agents/harnesses/availability'
import { MANAGED_HARNESS_CATALOG } from '@/shared/agents/harness-catalog'
import { agentEnvironmentErrorResponse } from '../shared'

export const maxDuration = 300

/**
 * What the create-agent picker may offer for "Hosted on Overlay Cloud": the
 * harness catalog entries this workspace is allowed to run. Returns 404 when
 * the feature, rollout stage, or workspace policy gates it off — the editor
 * probes this like it probes `agent-bindings` for the BYO branch.
 */
export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const availability = await managedHarnessAvailability({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    if (!availability.enabled) {
      // Grandfathering: creation may be gated while existing bindings still
      // run. Surface the harnesses this workspace actually has bound — marked
      // legacy so the editor renders them read-only — instead of a bare 404.
      const legacy = await legacyBoundHarnesses(context)
      if (legacy.length === 0) {
        return NextResponse.json({ error: 'Managed harness agents are disabled', code: 'capability_disabled' }, { status: 404 })
      }
      return NextResponse.json({
        harnesses: legacy,
        providers: [],
        workingDirectory: '/workspace',
      }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({
      harnesses: availability.harnesses.map((entry) => ({
        id: entry.id,
        label: entry.label,
        description: entry.description,
        byokProviders: entry.byokProviders,
        models: entry.models,
      })),
      providers: availability.providers,
      workingDirectory: '/workspace',
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}

/**
 * Creating agents that run on Overlay Cloud (managed harnesses, or the Agent
 * Host on a Box) is off for every workspace while those runtimes are rebuilt.
 * See docs/plans/SANDBOX_PROVIDER_CONSOLIDATION_PLAN.md.
 */
export async function POST(_request: Request, _context: AppApiRouteContext) {
  return NextResponse.json({
    error: 'Creating agents on Overlay Cloud is not available right now',
    code: 'capability_disabled',
  }, { status: 410, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Harness ids with live bindings in this workspace, projected onto the catalog
 * and flagged `legacy` so the editor can render a bound runtime read-only
 * without offering it for new agents.
 */
async function legacyBoundHarnesses(context: AppApiRouteContext) {
  const repository = getOverlayServerContext().appData.repositories.connectedAgents
  const bindings = await repository.listBindings({ workspaceId: context.workspace.workspace.id })
    .catch((_error) => [] as Awaited<ReturnType<typeof repository.listBindings>>)
  const boundIds = new Set(
    bindings
      .filter((binding) => binding.protocolAdapter === 'harness')
      .map((binding) => parseHarnessAgentBindingConfig(binding.adapterConfig)?.harnessId)
      .filter((harnessId): harnessId is NonNullable<typeof harnessId> => Boolean(harnessId)),
  )
  return MANAGED_HARNESS_CATALOG
    .filter((entry) => boundIds.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      byokProviders: entry.byokProviders,
      models: entry.models,
      legacy: true as const,
    }))
}
