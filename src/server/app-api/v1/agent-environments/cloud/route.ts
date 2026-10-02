import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlayRuntimeConfig } from '@/server/config'
import { CLOUD_AGENT_ADAPTER_IDS } from '@/server/agents/cloud/cloud-agent-machine'
import { CloudAgentMachineError } from '@/server/agents/cloud/CloudAgentMachineService'
import { createCloudAgentMachineService } from '@/server/agents/cloud/create-cloud-agent-machine-service'
import { getBillingProgrammaticSubjectId, getTrustedAutomationBillingSubjectId } from '@/server/app-api/bff-context'
import { isPaidPlan } from '@/server/billing/billing-runtime'
import { logger } from '@/server/observability/logger'
import { getAgentFacingBaseUrl } from '@/server/web/app-url'
import { AgentProviderAccountError } from '@/server/agents/provider-accounts/AgentProviderAccountService'
import { agentEnvironmentErrorResponse } from '../shared'

export const cloudAgentMachineRequestSchema = z.object({
  agentId: z.string().trim().min(1).max(256),
  adapterId: z.enum(CLOUD_AGENT_ADAPTER_IDS),
  /** The person's Claude Code or Codex account this agent runs on (Settings → Agent accounts). */
  providerAccountId: z.string().trim().min(1).max(64),
  size: z.enum(['small', 'default', 'large']).default('default'),
}).strict()

/**
 * Start provisioning an Overlay Cloud machine for an agent (202; progress is read from the agent's machine route): a Boat machine from the
 * Overlay agent image, running Claude Code or Codex behind the Agent Host,
 * enrolled, approved, and bound to the agent. Behind `overlayCloudEnvironments`.
 */
export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const config = await getOverlayRuntimeConfig()
    if (config.features.overlayCloudEnvironments !== true) {
      return NextResponse.json({ error: 'Overlay Cloud agents are disabled', code: 'capability_disabled' }, { status: 404 })
    }
    const body = cloudAgentMachineRequestSchema.parse(context.parsedJson)
    const server = getOverlayServerContext()
    // Fail before booting a machine if the account is missing, someone else's, or for another agent.
    await server.agentProviderAccounts.requireUsable({
      userId: context.auth.userId, accountId: body.providerAccountId, provider: body.adapterId,
    })
    // A cloud machine is a paid resource; free plans use Overlay agents or their own computer.
    const entitlements = await server.generationUsagePolicy.getEntitlements({
      programmaticSubjectId: getBillingProgrammaticSubjectId(context, getTrustedAutomationBillingSubjectId(context)),
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    if (!entitlements || !isPaidPlan(entitlements)) {
      return NextResponse.json(
        { error: 'Agents on Overlay Cloud need a paid plan.', code: 'paid_plan_required' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const service = createCloudAgentMachineService()
    const workspaceId = context.workspace.workspace.id
    const started = await server.appData.repositories.cloudAgentProvisions.begin({
      workspaceId, agentId: body.agentId, userId: context.auth.userId, now: Date.now(),
    })
    if (!started.started) {
      // Already starting (or running): report where it is rather than booting a second machine.
      return NextResponse.json({ phase: started.phase }, { status: 202, headers: { 'Cache-Control': 'no-store' } })
    }
    const provision = () => service.provision({
      actorUserId: context.auth.userId,
      workspaceId,
      agentId: body.agentId,
      adapterId: body.adapterId,
      providerAccountId: body.providerAccountId,
      size: body.size,
      // The configured app URL, not the request origin: behind a proxy or tunnel the
      // origin can be an internal host the machine cannot reach.
      serverUrl: getAgentFacingBaseUrl(),
    }).then(() => undefined).catch((error) => {
      // The failure is recorded for the agent page; nothing more to do here.
      logger.warn('[cloud-agent] provisioning failed', { agentId: body.agentId, error: error instanceof Error ? error.message : String(error) })
    })
    try {
      after(provision)
    } catch (_error) {
      void provision()
    }
    return NextResponse.json({ phase: started.phase }, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof AgentProviderAccountError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode, headers: { 'Cache-Control': 'no-store' } })
    }
    if (error instanceof CloudAgentMachineError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode, headers: { 'Cache-Control': 'no-store' } })
    }
    return agentEnvironmentErrorResponse(error)
  }
}
