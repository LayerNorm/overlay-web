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
}

export type NativeTurnStartDependencies = {
  buildInput?: typeof buildNativeHarnessWorkflowInput
  getAgentRun?: (args: { actorUserId: string; conversationId: string; runId: string }) => Promise<AgentRun | null>
  getPaid?: (run: AgentRun, workflowInput: NativeHarnessWorkflowInput) => Promise<boolean>
  repository?: Pick<ConvexHarnessRepository, 'admit'>
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

export async function startNativeHarnessTurn(
  input: NativeTurnStartInput,
  dependencies: NativeTurnStartDependencies = {},
): Promise<void> {
  const workflowInput = await (dependencies.buildInput ?? buildNativeHarnessWorkflowInput)(input)
  const server = getOverlayServerContext()
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
  if (!run || run.id !== workflowInput.access.agentRunId || run.executionEngine !== 'overlay_harness'
    || run.mode !== 'room' || run.runner !== 'workflow' || run.userId !== workflowInput.access.actorUserId
    || run.conversationId !== workflowInput.access.conversationId || run.agentId !== workflowInput.access.agentId
    || run.agentPrincipalId !== workflowInput.access.agentPrincipalId || run.turnId !== workflowInput.access.turnId
    || run.userMessageId !== workflowInput.access.userMessageId
    || run.assistantMessageId !== workflowInput.access.assistantMessageId) {
    throw new Error('The native agent delivery is no longer available.')
  }
  const paid = dependencies.getPaid
    ? await dependencies.getPaid(run, workflowInput)
    : (await new ActEntitlementService({
        repository: server.appData.repositories.conversations,
        usagePolicy: server.chatUsagePolicy,
      }).gateModelAccess({
        effectiveModelId: workflowInput.context.modelId,
        programmaticSubjectId: `agent:${run.agentId}`,
        userId: run.userId,
        workspaceId: workflowInput.access.workspaceId,
      })).paid
  const admitted = await (dependencies.repository ?? new ConvexHarnessRepository()).admit({
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
  if (['completed', 'failed', 'cancelled'].includes(admitted.status)) {
    throw new Error('This native Harness run has already ended.')
  }
  if (admitted.workflowRunId) return
  await (dependencies.startWorkflow ?? start)(nativeHarnessWorkflow, [workflowInput])
}
