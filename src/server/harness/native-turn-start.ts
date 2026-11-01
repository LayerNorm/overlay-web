import 'server-only'

import { start } from 'workflow/api'
import type { AgentRun } from '@/shared/agents/agent-run'
import { ActEntitlementService } from '@/server/conversations/ActEntitlementService'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { personalHarnessPolicy } from './personal-admission-policy'
import { harnessToolsRequirePlan } from './write-tools'
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
  expectedSurfaceWorkflowRunId?: string
  surfaceRootRunId?: string
}

export type PreparedNativeHarnessTurn = {
  workflowInput: NativeHarnessWorkflowInput
  admitted: Awaited<ReturnType<ConvexHarnessRepository['admit']>>
}

export type NativeTurnStartDependencies = {
  buildInput?: typeof buildNativeHarnessWorkflowInput
  getAgentRun?: (args: { actorUserId: string; conversationId: string; runId: string }) => Promise<AgentRun | null>
  getPaid?: (run: AgentRun, workflowInput: NativeHarnessWorkflowInput) => Promise<boolean>
  repository?: Pick<ConvexHarnessRepository, 'admit'>
  getSurfaceExecution?: (rootRunId: string) => ReturnType<ConvexHarnessRepository['getSurfaceExecutionByHarnessRunId']>
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

async function loadSurfaceExecution(
  input: NativeTurnStartInput,
  repository: ConvexHarnessRepository,
  dependencies: NativeTurnStartDependencies,
) {
  const rootRunId = input.surfaceRootRunId ?? `workspace:${input.runId}`
  const surfaceExecution = await (dependencies.getSurfaceExecution
    ?? (id => repository.getSurfaceExecutionByHarnessRunId(id)))(rootRunId)
  if (!surfaceExecution && !input.expectedSurfaceWorkflowRunId) return null
  if (!surfaceExecution) throw new Error('Native surface execution record is unavailable.')
  const isOwned = Boolean(input.expectedSurfaceWorkflowRunId)
    && surfaceExecution.workflowRunId === input.expectedSurfaceWorkflowRunId
    && surfaceExecution.actorUserId === input.actorUserId
    && surfaceExecution.workspaceId === input.workspaceId
    && surfaceExecution.conversationId === input.conversationId
    && (input.surfaceRootRunId !== undefined || surfaceExecution.agentRunId === input.runId)
  if (!isOwned) throw new Error('Native surface workflow ownership changed.')
  const { assertPersistedSurfaceSource } = await import('./surface-access')
  await assertPersistedSurfaceSource(surfaceExecution, input.expectedSurfaceWorkflowRunId)
  return surfaceExecution
}

async function loadNativeDelivery(
  input: NativeTurnStartInput,
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
    || run.userMessageId !== access.userMessageId || run.assistantMessageId !== access.assistantMessageId
    || (input.expectedSurfaceWorkflowRunId && run.workflowRunId
      && run.workflowRunId !== input.expectedSurfaceWorkflowRunId)) {
    throw new Error('The native agent delivery is no longer available.')
  }
  return run
}

async function isNativeDeliveryPaid(
  run: AgentRun,
  workflowInput: NativeHarnessWorkflowInput,
  surfaceExecution: Awaited<ReturnType<ConvexHarnessRepository['getSurfaceExecutionByHarnessRunId']>>,
  dependencies: NativeTurnStartDependencies,
  server: ReturnType<typeof getOverlayServerContext>,
): Promise<boolean> {
  if (dependencies.getPaid) return await dependencies.getPaid(run, workflowInput)
  return (await new ActEntitlementService({
    repository: server.appData.repositories.conversations,
    usagePolicy: server.chatUsagePolicy,
  }).gateModelAccess({
    effectiveModelId: workflowInput.context.modelId,
    programmaticSubjectId: surfaceExecution?.bindingId
      ? `surface:slack:${surfaceExecution.bindingId}`
      : `agent:${run.agentId}`,
    userId: run.userId,
    workspaceId: workflowInput.access.workspaceId,
  })).paid
}

function assertAdmissionCanStart(
  admitted: Awaited<ReturnType<ConvexHarnessRepository['admit']>>,
  expectedSurfaceWorkflowRunId?: string,
): boolean {
  if (['completed', 'failed', 'cancelled'].includes(admitted.status)) {
    throw new Error('This native Harness run has already ended.')
  }
  if (!admitted.workflowRunId) return true
  if (expectedSurfaceWorkflowRunId && admitted.workflowRunId !== expectedSurfaceWorkflowRunId) {
    throw new Error('Native Harness admission belongs to another workflow.')
  }
  return Boolean(expectedSurfaceWorkflowRunId)
}

export async function prepareNativeHarnessTurn(
  input: NativeTurnStartInput,
  dependencies: NativeTurnStartDependencies = {},
): Promise<PreparedNativeHarnessTurn | undefined> {
  const repository = new ConvexHarnessRepository()
  const surfaceExecution = await loadSurfaceExecution(input, repository, dependencies)
  const workflowInput = await (dependencies.buildInput ?? buildNativeHarnessWorkflowInput)({
    ...input,
    surfaceRootRunId: input.surfaceRootRunId,
    expectedSurfaceWorkflowRunId: input.expectedSurfaceWorkflowRunId,
  })
  const server = getOverlayServerContext()
  const run = await loadNativeDelivery(input, workflowInput, dependencies, server)
  const paid = await isNativeDeliveryPaid(run, workflowInput, surfaceExecution, dependencies, server)
  const admitted = await (dependencies.repository ?? repository).admit({
    runId: workflowInput.access.runId,
    goal: admissionGoal(workflowInput),
    constraints: [],
    policy: personalHarnessPolicy({
      actorUserId: workflowInput.access.actorUserId,
      workspaceId: workflowInput.access.workspaceId,
      allowedToolIds: workflowInput.definitions.map(definition => definition.name),
      requiresPlan: harnessToolsRequirePlan(workflowInput.definitions.map(definition => definition.name)),
      modelId: workflowInput.context.modelId,
      paid,
      createdAt: run.createdAt,
    }),
    source: { conversationId: workflowInput.access.conversationId },
    deliveryAgentRunId: workflowInput.access.agentRunId,
  })
  if (!assertAdmissionCanStart(admitted, input.expectedSurfaceWorkflowRunId)) return
  return { workflowInput, admitted }
}

export async function startNativeHarnessTurn(
  input: NativeTurnStartInput,
  dependencies: NativeTurnStartDependencies = {},
): Promise<void> {
  const prepared = await prepareNativeHarnessTurn(input, dependencies)
  if (prepared) await (dependencies.startWorkflow ?? start)(nativeHarnessWorkflow, [prepared.workflowInput])
}
