import 'server-only'

import { start } from 'workflow/api'
import type { AgentRun } from '@/shared/agents/agent-run'
import { ActEntitlementService } from '@/server/conversations/ActEntitlementService'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { personalHarnessPolicy } from './personal-admission-policy'
import { recordPublicStreamMetric } from './public-stream-metrics'
import { buildNativeHarnessWorkflowInput } from './native-workflow-input-builder'
import type { NativeHarnessWorkflowInput } from './native-workflow-input'
import { nativeHarnessWorkflow } from '@/server/workflows/native-harness'

type NativeTurnStartInput = {
  actorUserId: string
  workspaceId: string
  conversationId: string
  runId: string
  memoryEnabled: boolean
  threadRootMessageId?: string
}

export type PreparedNativeHarnessTurn = {
  workflowInput: NativeHarnessWorkflowInput
  admitted: Awaited<ReturnType<ConvexHarnessRepository['admit']>>
}

export type NativeTurnStartDependencies = {
  buildInput?: typeof buildNativeHarnessWorkflowInput
  getAgentRun?: (args: { actorUserId: string; conversationId: string; runId: string }) => Promise<AgentRun | null>
  getPaid?: (run: AgentRun, workflowInput: NativeHarnessWorkflowInput) => Promise<boolean>
  repository?: Pick<ConvexHarnessRepository, 'admit' | 'get'>
  acquireTurn?: ConvexHarnessRepository['acquireNativeTurn']
  startWorkflow?: (workflow: typeof nativeHarnessWorkflow, args: [NativeHarnessWorkflowInput]) => Promise<unknown>
}

function admissionGoal(input: NativeHarnessWorkflowInput): string {
  const latestUserMessage = [...input.messages].reverse().find(message => message.role === 'user')
  const content = latestUserMessage?.content
  const goal = (typeof content === 'string' ? content : JSON.stringify(content ?? '')).trim()
    || 'Respond to the latest user message and its attachments.'
  return goal.length > 32_000
    ? `${goal.slice(0, 31_900)}\nRead the full request in the latest user message.`
    : goal
}

async function loadNativeDelivery(
  workflowInput: NativeHarnessWorkflowInput,
  dependencies: NativeTurnStartDependencies,
  server: ReturnType<typeof getOverlayServerContext>,
) {
  const run = await (dependencies.getAgentRun ?? (args =>
    server.appData.repositories.conversations.getLatestAgentRun({
      agentRunId: args.runId,
      conversationId: asConversationId(args.conversationId),
      userId: args.actorUserId,
    })))({
    actorUserId: workflowInput.access.actorUserId,
    conversationId: workflowInput.access.conversationId,
    runId: workflowInput.access.agentRunId,
  })
  const access = workflowInput.access
  if (!run || run.id !== access.agentRunId || run.executionEngine !== 'overlay_harness'
    || run.mode !== 'room' || run.runner !== 'workflow' || run.userId !== access.actorUserId
    || run.conversationId !== access.conversationId || run.agentId !== access.agentId
    || run.agentPrincipalId !== access.agentPrincipalId || run.turnId !== access.turnId
    || run.userMessageId !== access.userMessageId || run.assistantMessageId !== access.assistantMessageId) {
    throw new Error('The native agent delivery is no longer available.')
  }
  return run
}

async function isNativeDeliveryPaid(
  run: AgentRun,
  workflowInput: NativeHarnessWorkflowInput,
  dependencies: NativeTurnStartDependencies,
  server: ReturnType<typeof getOverlayServerContext>,
): Promise<boolean> {
  if (dependencies.getPaid) return await dependencies.getPaid(run, workflowInput)
  return (await new ActEntitlementService({
    repository: server.appData.repositories.conversations,
    usagePolicy: server.chatUsagePolicy,
  }).gateModelAccess({
    effectiveModelId: workflowInput.context.modelId,
    programmaticSubjectId: `agent:${run.agentId}`,
    userId: run.userId,
    workspaceId: workflowInput.access.workspaceId,
  })).paid
}

/** A duplicate admission that already owns a workflow reconnects to it instead of starting another. */
function assertAdmissionCanStart(admitted: Awaited<ReturnType<ConvexHarnessRepository['admit']>>): boolean {
  if (['completed', 'failed', 'cancelled'].includes(admitted.status)) {
    throw new Error('This native Harness run has already ended.')
  }
  return !admitted.workflowRunId
}

export async function prepareNativeHarnessTurn(
  input: NativeTurnStartInput,
  dependencies: NativeTurnStartDependencies = {},
): Promise<PreparedNativeHarnessTurn | undefined> {
  const repository = new ConvexHarnessRepository()
  const workflowInput = await (dependencies.buildInput ?? buildNativeHarnessWorkflowInput)(input)
  const server = getOverlayServerContext()
  const run = await loadNativeDelivery(workflowInput, dependencies, server)
  if (!await (dependencies.acquireTurn ?? repository.acquireNativeTurn.bind(repository))({ actorUserId: input.actorUserId, deliveryAgentRunId: input.runId, memoryEnabled: input.memoryEnabled })) return
  const paid = await isNativeDeliveryPaid(run, workflowInput, dependencies, server)
  const admissionRepository = dependencies.repository ?? repository
  const existing = admissionRepository.get
    ? await admissionRepository.get({ actorUserId: workflowInput.access.actorUserId, runId: workflowInput.access.runId })
    : null
  const admitted = await admissionRepository.admit({
    runId: workflowInput.access.runId,
    goal: admissionGoal(workflowInput),
    constraints: [],
    policy: personalHarnessPolicy({
      actorUserId: workflowInput.access.actorUserId,
      workspaceId: workflowInput.access.workspaceId,
      allowedToolIds: workflowInput.definitions.map(definition => definition.name),
      modelId: workflowInput.context.modelId,
      paid,
      createdAt: run.createdAt,
      existingPolicy: existing?.policy,
    }),
    source: { conversationId: workflowInput.access.conversationId },
    deliveryAgentRunId: workflowInput.access.agentRunId,
  })
  if (admitted.policy?.publicStreamVersion === 1) recordPublicStreamMetric({
    event: 'admission_accepted', runId: workflowInput.access.runId,
    generation: admitted.executionGeneration ?? 0, modelId: workflowInput.context.modelId,
  })
  if (!assertAdmissionCanStart(admitted)) return
  return { workflowInput, admitted }
}

export async function startNativeHarnessTurn(
  input: NativeTurnStartInput,
  dependencies: NativeTurnStartDependencies = {},
): Promise<void> {
  const prepared = await prepareNativeHarnessTurn(input, dependencies)
  if (prepared) await (dependencies.startWorkflow ?? start)(nativeHarnessWorkflow, [prepared.workflowInput])
}
