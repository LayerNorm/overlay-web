import { NextResponse } from 'next/server'
import { isOverlayManagedAcpAdapterId } from '@overlay/sandbox-runtime'
import { isManagedHarnessId } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlayRuntimeConfig } from '@/server/config'
import {
  ManagedAgentSandboxError,
  ManagedAgentSandboxService,
} from '@/server/agents/ManagedAgentSandboxService'
import { managedHarnessAvailability } from '@/server/agents/harnesses/availability'
import { managedHarnessSandboxProviders } from '@/server/agents/harnesses/sandbox-providers'
import { connectedAgentPolicyFor } from '@/server/agents/ConnectedAgentPolicy'
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
      return NextResponse.json({ error: 'Managed harness agents are disabled', code: 'capability_disabled' }, { status: 404 })
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

export async function POST(request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as Partial<{
      adapterId: string
      mode: string
      harnessId: string
      provider: string
    }>
    const config = await getOverlayRuntimeConfig()
    if (config.features.overlayCloudEnvironments !== true) {
      return NextResponse.json({ error: 'Overlay Cloud environments are disabled', code: 'capability_disabled' }, { status: 404 })
    }
    const server = getOverlayServerContext()
    const service = new ManagedAgentSandboxService({
      audit: server.auditService,
      controlPlane: server.connectedAgentControlPlane,
      repository: server.appData.repositories.connectedAgents,
      policyLimits: async ({ userId, workspaceId }) => {
        const entitlements = await server.chatUsagePolicy.getEntitlements({ userId, workspaceId })
        if (!entitlements) throw new ManagedAgentSandboxError('Could not verify subscription', 401, 'not_entitled')
        return connectedAgentPolicyFor(entitlements)
      },
    })
    const common = {
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      serverUrl: new URL(request.url).origin,
    }

    if (body.mode === 'harness') {
      const availability = await managedHarnessAvailability({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
      })
      if (!availability.enabled) {
        return NextResponse.json({ error: 'Managed harness agents are disabled', code: 'capability_disabled' }, { status: 404 })
      }
      const harnessId = body.harnessId?.trim()
      if (!isManagedHarnessId(harnessId) || !availability.harnesses.some((entry) => entry.id === harnessId)) {
        return NextResponse.json({ error: 'Unsupported managed harness', code: 'harness_invalid' }, { status: 400 })
      }
      const provider = body.provider?.trim() || undefined
      if (provider && !managedHarnessSandboxProviders().includes(provider as never)) {
        return NextResponse.json({ error: 'Managed sandbox provider is unavailable', code: 'provider_unavailable' }, { status: 400 })
      }
      const provisioned = await service.provision({ ...common, mode: 'harness', harnessId, provider })
      return NextResponse.json(provisioned, { status: 201, headers: { 'Cache-Control': 'no-store' } })
    }

    const adapterId = body.adapterId?.trim() || 'codex'
    if (!isOverlayManagedAcpAdapterId(adapterId)) {
      return NextResponse.json({ error: 'Unsupported agent harness', code: 'adapter_invalid' }, { status: 400 })
    }
    const provisioned = await service.provision({ ...common, adapterId })
    return NextResponse.json(provisioned, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ManagedAgentSandboxError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return agentEnvironmentErrorResponse(error)
  }
}
