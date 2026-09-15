import 'server-only'

/**
 * Durable steps of a managed HarnessAgent turn.
 *
 * Each is a `"use step"` so `managedHarnessAgentTurnWorkflow` can replay: the
 * whole state of a turn is the serializable `HarnessWorkflowState` threaded
 * between these steps plus the `agentHarnessSessions` row that carries
 * `resumeFrom` into the next user turn.
 *
 * All `@ai-sdk/*` imports are dynamic — workflow step bundles must not pull
 * the harness graph in at module scope.
 *
 * See `docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md`, Phase 2.
 */

import { randomUUID } from 'node:crypto'
import type { SandboxInstance } from '@overlay/sandbox-runtime'
import type { ManagedHarnessId } from '@overlay/workspace-contracts'
import type { ConnectedAgentSandboxBilling } from '@/server/agents/ConnectedAgentRepository'
import { ManagedAgentSandboxBilling } from '@/server/agents/ManagedAgentSandboxBilling'
import {
  MANAGED_HARNESS_DENIED_CIDRS,
  MANAGED_HARNESS_IDLE_TIMEOUT_MS,
  managedHarnessAllowedDomainsForHost,
  managedSandboxRuntimeFromEnv,
} from '@/server/agents/ManagedAgentSandboxService'
import { createAgentMessageStream } from '@/server/agents/agent-message-stream'
import { createHarnessTranscriptWritable, type HarnessTranscriptSnapshot } from '@/server/agents/harnesses/transcript-writable'
import { createManagedHarnessAgent, managedHarnessDescriptor } from '@/server/agents/harnesses/registry'
import { managedHarnessEntry } from '@/shared/agents/harness-catalog'
import { agentMemoryOwnerId } from '@/shared/agents/agent-memory'
import { compactAssistantPersistenceForConvex } from '@/shared/chat/persist-assistant-turn'
import { getOverlayServerContext } from '@/server/bootstrap'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { agentRunService } from '@/server/conversations/http'
import { logger } from '@/server/observability/logger'

/**
 * One workflow step runs one harness slice; the slice budget stays under the
 * platform's step ceiling and under the sandbox idle timeout so a suspended
 * turn can be continued by the next step before the sandbox cools.
 */
export const MANAGED_HARNESS_TIME_SLICE_SECONDS = 240

/** Shape the workflow threads between slices — must stay JSON-serializable. */
export type ManagedHarnessWorkflowState = {
  readonly sessionId: string
  readonly prompt: unknown
  readonly messages?: unknown[]
  readonly status: string
  readonly resumeFrom?: Record<string, unknown>
  readonly continueFrom?: Record<string, unknown>
  readonly streamContext?: Record<string, unknown>
  readonly finalResult?: {
    readonly sessionId: string
    readonly finishReason: string
    readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }
  }
  readonly error?: string
}

export type ManagedHarnessSliceResult = {
  state: ManagedHarnessWorkflowState
  transcript: HarnessTranscriptSnapshot
}

type HarnessTurnIdentity = {
  actorUserId: string
  agentId: string
  agentPrincipalId: string
  bindingId: string
  conversationId: string
  environmentId: string
  harnessId: ManagedHarnessId
  /** Harness-native model alias for the HarnessAgent settings. */
  harnessModel?: string
  /** The agent record's standing instructions. */
  instructions?: string
  invocationNonce: string
  modelId: string
  /** The full room-context prompt envelope, sent once on the first slice. */
  prompt: string
  runId: string
  threadRootMessageId?: string
  turnId: string
  turnMessageId: string
  workingDirectory: string
  workspaceId: string
}

function repositories() {
  const server = getOverlayServerContext()
  return {
    collaboration: server.appData.repositories.conversationCollaboration,
    connectedAgents: server.appData.repositories.connectedAgents,
    server,
  }
}

/**
 * Reconnects to the lease's sandbox, recreating it when the provider reference
 * is stale (sandbox expired or deleted) and writing the new reference back to
 * the lease. Returns the live instance; callers wrap the native handle.
 */
async function ensureHarnessSandboxInstance(args: {
  environmentId: string
  harnessId: ManagedHarnessId
  workspaceId: string
}): Promise<{ instance: SandboxInstance; recreated: boolean }> {
  const { connectedAgents } = repositories()
  const lease = await connectedAgents.getActiveSandboxLease({
    workspaceId: args.workspaceId,
    environmentId: args.environmentId,
  })
  if (!lease || lease.status !== 'running') {
    throw harnessTurnError('The managed sandbox for this agent is not running.')
  }
  const runtime = managedSandboxRuntimeFromEnv(lease.provider)
  if (lease.providerReference) {
    const existing = await runtime.reconnect(lease.providerReference).catch((_error) => null)
    if (existing && (await existing.status()) !== 'failed' && (await existing.status()) !== 'deleted') {
      return { instance: existing, recreated: false }
    }
  }
  // Stale or missing provider reference — recreate with the same harness
  // posture and point the lease at the new sandbox.
  const environment = await connectedAgents.getEnvironment({
    workspaceId: args.workspaceId,
    environmentId: args.environmentId,
  })
  const capabilities = environment?.capabilities ?? {}
  const serverHost = typeof capabilities.serverHost === 'string' ? capabilities.serverHost : undefined
  const descriptor = managedHarnessDescriptor(args.harnessId)
  const entry = managedHarnessEntry(args.harnessId)
  const now = Date.now()
  const instance = await runtime.create({
    name: `overlay-harness-${randomUUID().slice(0, 8).toLowerCase()}`,
    persistent: true,
    ports: entry?.requiresSandboxPort && descriptor.bridgePort ? [descriptor.bridgePort] : [],
    networkPolicy: {
      mode: 'allowlist',
      domains: managedHarnessAllowedDomainsForHost(serverHost, descriptor.modelApiHosts),
      deniedCidrs: [...MANAGED_HARNESS_DENIED_CIDRS],
    },
    idleTimeoutMs: MANAGED_HARNESS_IDLE_TIMEOUT_MS,
    hardTimeoutMs: Math.max(60_000, lease.reservedUntil - now),
    resources: leaseResources(lease.usage),
    metadata: {
      overlay: 'true', kind: 'managed-harness', harness: args.harnessId, workspace: args.workspaceId,
    },
  })
  const updated = await connectedAgents.updateSandboxLease({
    workspaceId: args.workspaceId,
    leaseId: lease.id,
    providerReference: instance.reference,
    now,
  })
  if (!updated) {
    await instance.delete().catch((_error) => undefined)
    throw harnessTurnError('The managed sandbox lease could not be updated.')
  }
  logger.warn('[managed-harness] recreated expired managed sandbox', {
    environmentId: args.environmentId,
    workspaceId: args.workspaceId,
    harnessId: args.harnessId,
  })
  return { instance, recreated: true }
}

function leaseResources(usage: Record<string, unknown>) {
  const stored = usage.resources && typeof usage.resources === 'object'
    ? usage.resources as Record<string, unknown> : {}
  const positive = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
  return {
    diskGiB: positive(stored.diskGiB, 20),
    memoryGiB: positive(stored.memoryGiB, 4),
    vcpus: positive(stored.vcpus, 2),
  }
}

function harnessTurnError(message: string) {
  const error = new Error(message)
  error.name = 'WorkspaceAgentInvocationError'
  ;(error as { reasonCode?: string }).reasonCode = 'model_failed'
  return error
}

/**
 * Wraps a reconnected sandbox instance as a `HarnessV1SandboxProvider`. Only
 * Vercel is supported in v1 — the lease records which provider created it.
 */
async function wrapHarnessSandbox(instance: SandboxInstance, provider: string) {
  if (provider !== 'vercel') {
    throw harnessTurnError(`Managed harness sandbox provider '${provider}' is not supported yet.`)
  }
  const { createVercelSandbox } = await import('@ai-sdk/sandbox-vercel')
  const native = instance.rawProviderDiagnosticHandle()
  if (!native || typeof native !== 'object') {
    throw harnessTurnError('The managed sandbox did not expose a provider handle.')
  }
  return createVercelSandbox({ sandbox: native as never })
}

/**
 * Acquire-step: reads the persisted harness session for this
 * (binding, conversation) pair and verifies the sandbox is alive before the
 * first slice. Session coordinates come back as plain JSON so they can be
 * threaded through the workflow body.
 */
export async function acquireManagedHarnessTurn(input: {
  bindingId: string
  conversationId: string
  environmentId: string
  harnessId: ManagedHarnessId
  workspaceId: string
}): Promise<{
  sessionId: string
  resumeFrom?: Record<string, unknown>
}> {
  'use step'
  const { connectedAgents } = repositories()
  const record = await connectedAgents.getHarnessSession({
    workspaceId: input.workspaceId,
    bindingId: input.bindingId,
    conversationId: input.conversationId,
  })
  await ensureHarnessSandboxInstance({
    environmentId: input.environmentId,
    harnessId: input.harnessId,
    workspaceId: input.workspaceId,
  })
  return {
    sessionId: record?.sessionId ?? `harness_${randomUUID()}`,
    ...(record?.resumeState && Object.keys(record.resumeState).length > 0
      ? { resumeFrom: record.resumeState }
      : {}),
  }
}

/**
 * Runs one time-sliced piece of the turn: ensure the sandbox, wrap the native
 * handle, build the HarnessAgent, then drive `runHarnessAgentTimeSlice` with a
 * writable that projects stream chunks into the reply row. The returned state
 * is the durable cursor for the next slice (or the next user turn, via
 * `agentHarnessSessions.resumeState`).
 */
export async function runManagedHarnessTurnSlice(input: HarnessTurnIdentity & {
  state: ManagedHarnessWorkflowState | null
  sessionId: string
  resumeFrom?: Record<string, unknown>
  transcript: HarnessTranscriptSnapshot
}): Promise<ManagedHarnessSliceResult> {
  'use step'
  const { collaboration, connectedAgents, server } = repositories()
  // A cancelled run row lands before the workflow runtime aborts the run —
  // checking here means a cancel between slices never pays for sandbox work.
  const latestRun = await server.appData.repositories.conversations.getLatestAgentRun({
    conversationId: asConversationId(input.conversationId),
    userId: input.actorUserId,
  }).catch((_error) => null)
  if (latestRun && latestRun.id === input.runId && latestRun.status === 'cancelled') {
    throw harnessTurnError('The agent run was cancelled.')
  }
  const { instance } = await ensureHarnessSandboxInstance({
    environmentId: input.environmentId,
    harnessId: input.harnessId,
    workspaceId: input.workspaceId,
  })
  const sandbox = await wrapHarnessSandbox(instance, instance.provider)
  const agent = await createManagedHarnessAgent({
    harnessId: input.harnessId,
    ...(input.harnessModel ? { model: input.harnessModel } : {}),
    ...(input.instructions ? { instructions: input.instructions } : {}),
    sandbox,
    sandboxConfig: {
      // Binding directories are absolute POSIX roots; the harness resolves
      // workDir relative to the sandbox's home directory.
      workDir: input.workingDirectory.replace(/^\/+/, ''),
    },
    // v1 policy: the sandbox boundary (egress allowlist + denied CIDRs) is the
    // safety story, so built-in tools run without per-call approval — anything
    // stricter would suspend the turn on approvals nobody can serve yet.
    // Interactive approval arrives later via suspendTurn + AgentApprovalRequest.
    permissionMode: 'allow-all',
    // Elicitation is disabled in v1: `askUserQuestions` would park the turn on
    // input the room cannot deliver.
    inactiveTools: ['askUserQuestions'],
    onLog: (event) => {
      logger.info('[managed-harness] harness diagnostic', {
        conversationId: input.conversationId,
        harnessId: input.harnessId,
        runId: input.turnId,
        event: event && typeof event === 'object' ? (event as { type?: unknown }).type : undefined,
      })
    },
  })
  const stream = createAgentMessageStream({
    actorUserId: input.actorUserId,
    authorPrincipalId: input.agentPrincipalId,
    clientNonce: input.invocationNonce,
    conversationId: input.conversationId,
    existingMessageId: input.turnMessageId,
    modelId: input.modelId,
    store: collaboration,
    threadRootMessageId: input.threadRootMessageId,
    turnId: input.turnId,
    workspaceId: input.workspaceId,
  })
  const transcript = createHarnessTranscriptWritable({
    initial: input.transcript,
    sink: stream,
  })
  const { createHarnessWorkflowState, runHarnessAgentTimeSlice } = await import('@ai-sdk/workflow-harness')
  const state = (input.state ?? createHarnessWorkflowState({
    sessionId: input.sessionId,
    prompt: input.prompt,
    ...(input.resumeFrom ? { resumeFrom: input.resumeFrom as never } : {}),
  })) as never
  let next: ManagedHarnessWorkflowState
  try {
    next = await runHarnessAgentTimeSlice({
      agent,
      state,
      timeSliceSeconds: MANAGED_HARNESS_TIME_SLICE_SECONDS,
      writable: transcript.writable,
    }) as ManagedHarnessWorkflowState
  } catch (error) {
    // A persisted resume/continuation handle can go stale (sandbox rebuilt,
    // native session gone). Retry the slice once on a fresh session rather
    // than failing a turn the user can still see.
    if (!input.resumeFrom && !input.state?.continueFrom) throw error
    logger.warn('[managed-harness] resume handle rejected, retrying on a fresh session', {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
      harnessId: input.harnessId,
    })
    const { createHarnessWorkflowState: createFresh } = await import('@ai-sdk/workflow-harness')
    next = await runHarnessAgentTimeSlice({
      agent,
      state: createFresh({ sessionId: input.sessionId, prompt: input.prompt }) as never,
      timeSliceSeconds: MANAGED_HARNESS_TIME_SLICE_SECONDS,
      writable: transcript.writable,
    }) as ManagedHarnessWorkflowState
  }
  // Buffered text that never crossed a flush threshold would be lost when the
  // step exits — drain before persisting session state.
  await stream.flush()
  const prior = await connectedAgents.getHarnessSession({
    workspaceId: input.workspaceId,
    bindingId: input.bindingId,
    conversationId: input.conversationId,
  })
  await connectedAgents.upsertHarnessSession({
    id: prior?.id ?? `agent_harness_session_${randomUUID()}`,
    workspaceId: input.workspaceId,
    bindingId: input.bindingId,
    conversationId: input.conversationId,
    harnessId: input.harnessId,
    sessionId: next.sessionId,
    // Mid-turn slices carry `continueFrom` (kept in workflow state) rather than
    // a fresh resume handle — keep the last good one instead of clobbering it.
    ...(next.resumeFrom !== undefined || prior?.resumeState !== undefined
      ? { resumeState: (next.resumeFrom ?? prior?.resumeState) as Record<string, unknown> }
      : {}),
    now: Date.now(),
  })
  return { state: next, transcript: transcript.snapshot() }
}

/**
 * Terminal step for a finished turn: closes the reply row authoritatively,
 * records model usage against the reservation, and settles sandbox billing.
 * Returns `null` for an empty reply so the workflow can abandon the run.
 */
export async function finalizeManagedHarnessTurn(input: HarnessTurnIdentity & {
  memoryEnabled?: boolean
  reservationId: string | null
  sandboxBilling?: ConnectedAgentSandboxBilling | null
  state: ManagedHarnessWorkflowState
  transcript: HarnessTranscriptSnapshot
}): Promise<{ content: string; modelId: string; parts: Array<Record<string, unknown>>; tokens: { input: number; output: number } } | null> {
  'use step'
  const { collaboration, server } = repositories()
  const tokens = {
    input: input.state.finalResult?.usage?.inputTokens ?? 0,
    output: input.state.finalResult?.usage?.outputTokens ?? 0,
  }
  const content = input.transcript.content.trim()
  if (!content) {
    await collaboration.failAgentMessage({
      actorUserId: input.actorUserId,
      conversationId: input.conversationId,
      messageId: input.turnMessageId,
      workspaceId: input.workspaceId,
    }).catch((_error) => undefined)
    await server.chatUsagePolicy.releaseReservation({
      reason: 'workspace_agent_empty_response',
      reservationId: input.reservationId,
      userId: input.actorUserId,
    }).catch((_error) => undefined)
    await settleManagedHarnessSandbox({ ...input, outcome: 'failed', outputTokens: 0, inputTokens: 0 })
    return null
  }
  // The same bounded representation keeps Convex's nested-document limits
  // from turning a successful turn into a persistence failure.
  const persistence = compactAssistantPersistenceForConvex({
    content,
    parts: input.transcript.parts.length > 0 ? input.transcript.parts : [{ type: 'text', text: content }],
  })
  await collaboration.finalizeAgentMessage({
    actorUserId: input.actorUserId,
    content: persistence.content,
    conversationId: input.conversationId,
    messageId: input.turnMessageId,
    parts: persistence.parts,
    tokens,
    workspaceId: input.workspaceId,
  })
  if (input.memoryEnabled) {
    await collaboration.enqueueMemoryExtraction({
      actorUserId: input.actorUserId,
      conversationId: input.conversationId,
      memoryOwnerId: agentMemoryOwnerId(input.agentId),
      messageId: input.turnMessageId,
      targetActor: 'agent',
      turnId: input.turnId,
      workspaceId: input.workspaceId,
    }).catch((error) => {
      logger.warn('[managed-harness] failed to enqueue agent memory extraction', { error })
    })
  }
  await server.chatUsagePolicy.recordFinishedUsage({
    forceFreeTierLimits: false,
    inputTokens: tokens.input,
    modelId: input.modelId,
    outputTokens: tokens.output,
    reservationId: input.reservationId,
    userId: input.actorUserId,
  })
  await settleManagedHarnessSandbox({ ...input, outcome: 'completed' })
  return { content: persistence.content, modelId: input.modelId, parts: persistence.parts, tokens }
}

/**
 * Failure/cancellation path: destroy the harness session so nothing keeps
 * running against the sandbox, release the model reservation, settle the
 * sandbox reservation against actual usage, then close the row and the run —
 * mirroring `failWorkspaceAgentRun` with the harness-specific cleanup added.
 */
export async function failManagedHarnessTurn(input: HarnessTurnIdentity & {
  errorMessage: string
  reasonCode: string
  reservationId: string | null
  retryable: boolean
  sandboxBilling?: ConnectedAgentSandboxBilling | null
  sessionId?: string
  resumeFrom?: Record<string, unknown>
  continueFrom?: Record<string, unknown>
}) {
  'use step'
  const { collaboration, server } = repositories()
  await destroyManagedHarnessSessionHandle(input).catch((error) => {
    logger.warn('[managed-harness] session cleanup failed', {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
  await server.chatUsagePolicy.releaseReservation({
    reason: 'workspace_agent_invocation_failed',
    reservationId: input.reservationId,
    userId: input.actorUserId,
  }).catch((_error) => undefined)
  await settleManagedHarnessSandbox({ ...input, outcome: 'failed', inputTokens: 0, outputTokens: 0 }).catch((error) => {
    logger.warn('[managed-harness] sandbox settlement failed on error path', {
      error: error instanceof Error ? error.message : String(error),
      runId: input.runId,
    })
  })
  // Close the reply row first so partial output survives the failure.
  await collaboration.failAgentMessage({
    actorUserId: input.actorUserId,
    conversationId: input.conversationId,
    messageId: input.turnMessageId,
    workspaceId: input.workspaceId,
  }).catch((_error) => undefined)
  return await agentRunService.fail({
    error: { code: input.reasonCode, message: input.errorMessage, retryable: input.retryable },
    errorText: input.errorMessage,
    runId: input.runId,
    userId: input.actorUserId,
  })
}

/**
 * Best-effort session teardown used by the failure path. A destroyed session
 * cannot be resumed, so the persisted `resumeState` is cleared — the next
 * user turn starts a fresh native session on the same stable sessionId.
 */
async function destroyManagedHarnessSessionHandle(input: HarnessTurnIdentity & {
  sessionId?: string
  resumeFrom?: Record<string, unknown>
  continueFrom?: Record<string, unknown>
}) {
  if (!input.sessionId) return
  const { connectedAgents } = repositories()
  const { instance } = await ensureHarnessSandboxInstance({
    environmentId: input.environmentId,
    harnessId: input.harnessId,
    workspaceId: input.workspaceId,
  })
  const sandbox = await wrapHarnessSandbox(instance, instance.provider)
  const agent = await createManagedHarnessAgent({
    harnessId: input.harnessId,
    sandbox,
    permissionMode: 'allow-all',
    inactiveTools: ['askUserQuestions'],
  })
  const session = await agent.createSession({
    sessionId: input.sessionId,
    // Persisted payloads are opaque — they round-trip through JSON unchanged.
    ...(input.continueFrom ? { continueFrom: input.continueFrom as never } : {}),
    ...(input.resumeFrom ? { resumeFrom: input.resumeFrom as never } : {}),
  })
  await session.destroy()
  const prior = await connectedAgents.getHarnessSession({
    workspaceId: input.workspaceId,
    bindingId: input.bindingId,
    conversationId: input.conversationId,
  })
  if (prior) {
    await connectedAgents.upsertHarnessSession({
      id: prior.id,
      workspaceId: input.workspaceId,
      bindingId: input.bindingId,
      conversationId: input.conversationId,
      harnessId: input.harnessId,
      sessionId: input.sessionId,
      resumeState: undefined,
      now: Date.now(),
    })
  }
}

async function settleManagedHarnessSandbox(input: HarnessTurnIdentity & {
  memoryEnabled?: boolean
  outcome: 'completed' | 'failed'
  inputTokens?: number
  outputTokens?: number
  reservationId: string | null
  sandboxBilling?: ConnectedAgentSandboxBilling | null
}) {
  if (!input.sandboxBilling?.reservationId) return
  const { server } = repositories()
  const billingService = new ManagedAgentSandboxBilling({
    policy: server.generationUsagePolicy,
    repository: server.appData.repositories.connectedAgents,
  })
  await billingService.settle({
    agentId: input.agentId,
    conversationId: input.conversationId,
    environmentId: input.environmentId,
    forceFreeTierLimits: false,
    inputTokens: input.inputTokens ?? 0,
    modelId: input.modelId,
    modelUsageBilling: 'overlay',
    memoryEnabled: input.memoryEnabled !== false,
    messageId: input.turnMessageId,
    operationId: `workspace-agent:${input.turnId}`,
    outputTokens: input.outputTokens ?? 0,
    outcome: input.outcome,
    reservationId: input.reservationId,
    runId: input.runId,
    sandboxBilling: input.sandboxBilling,
    userId: input.actorUserId,
    turnId: input.turnId,
    workspaceId: input.workspaceId,
  })
}
