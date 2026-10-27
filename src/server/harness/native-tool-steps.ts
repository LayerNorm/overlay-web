import 'server-only'

import { FatalError } from 'workflow'
import { reservedHarnessCostMicros } from '@overlay/agent-runtime/harness-state'
import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'
import { buildWorkspaceAgentTooling, type WorkspaceAgentToolingResult } from '@/server/agents/agent-tooling'
import { resolveWorkspaceAgentInvocations } from '@/server/agents/workspace-agent-invocation'
import { agentStartFailureMessage } from '@/server/app-api/v1/conversations/message/agent-start-failure'
import { getOverlayServerContext } from '@/server/bootstrap'
import { buildNativeHarnessWorkflowInput } from './native-workflow-input-builder'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { startNativeHarnessNamedChild } from './native-named-child-launch'
import { executePersonalChatWorkToolResult } from '@/server/conversations/personal-chat-work-tools'
import { refreshNativeHarnessAccess } from './native-access'
import type { NativeHarnessToolsInput } from './native-tools'
import type { HarnessToolCall } from './tools'

type NativeToolCall = HarnessToolCall & Pick<NativeHarnessToolsInput, 'access' | 'context'>

function idempotencyKey(call: NativeToolCall): string {
  if (!call.toolCallId || call.toolCallId.length > 256) throw new FatalError('Invalid native tool call identity.')
  return `harness-run:${call.access.runId}:tool:${call.toolCallId}`
}

async function freshTooling(call: NativeToolCall) {
  const authority = await refreshNativeHarnessAccess(call.access, call.context, call.toolName)
  const { agent } = authority
  const tooling = await buildWorkspaceAgentTooling({
    actorUserId: call.access.actorUserId, agentPrincipalId: call.access.agentPrincipalId,
    conversationId: call.access.conversationId, effectiveModelId: call.context.modelId,
    entitlements: authority.entitlements, paid: authority.paid,
    grant: { agentId: agent.id, allowedToolIds: agent.allowedToolIds, isDefaultMaster: Boolean(agent.isDefault || agent.name.toLowerCase() === 'overlay') },
    approvalMode: agent.permissionMode === 'auto' ? 'auto' : 'ask', computerApprovalContext: 'work',
    idempotencyKey: idempotencyKey(call), latestUserText: authority.latestUserText,
    memoryEnabled: call.context.memoryEnabled, requestFingerprint: call.context.requestFingerprint,
    turnId: call.access.turnId, workspaceId: call.access.workspaceId,
  })
  if (!tooling.tools[call.toolName]?.execute) throw new FatalError('This native tool is no longer authorized.')
  return tooling
}

async function needsApproval(tooling: WorkspaceAgentToolingResult, call: NativeToolCall): Promise<boolean> {
  const definition = tooling.tools[call.toolName]
  const dynamic = typeof definition.needsApproval === 'function'
    ? await definition.needsApproval(call.input as never, {
      toolCallId: call.toolCallId, messages: call.messages, context: tooling.toolsContext?.[call.toolName],
    } as never) : definition.needsApproval === true
  return dynamic || tooling.toolApproval?.({ toolCall: {
    toolName: call.toolName, input: (call.input && typeof call.input === 'object' ? call.input : {}) as Record<string, unknown>,
  } }) === 'user-approval'
}

export async function nativeHarnessToolNeedsApproval(call: NativeToolCall): Promise<boolean> {
  'use step'
  return needsApproval(await freshTooling(call), call)
}

export async function executeNativeHarnessTool(call: NativeToolCall, approved: boolean): Promise<unknown> {
  'use step'
  const initial = await freshTooling(call)
  if (await needsApproval(initial, call) && !approved) throw new FatalError('This native action requires fresh approval.')
  const current = await freshTooling(call)
  if (await needsApproval(current, call) && !approved) throw new FatalError('This native action became approval-required before execution.')
  const definition = current.tools[call.toolName]
  return executePersonalChatWorkToolResult({
    execute: () => definition.execute!(call.input as never, {
      toolCallId: call.toolCallId, messages: call.messages, context: current.toolsContext?.[call.toolName],
      agentRunId: call.access.agentRunId, logicalStepId: call.toolCallId, idempotencyKey: idempotencyKey(call),
    } as never),
    input: call.input, toolCallId: call.toolCallId,
    toModelOutput: typeof definition.toModelOutput === 'function'
      ? async args => definition.toModelOutput!(args as never) : undefined,
  })
}

executeNativeHarnessTool.maxRetries = 0

export async function dispatchNativeHarnessAgentRequest(
  access: NativeHarnessToolsInput['access'],
  context: NativeHarnessToolsInput['context'],
  toolCallId: string,
  toolName: string,
  input: unknown,
): Promise<unknown> {
  'use step'
  if (!toolCallId || toolCallId.length > 256 || !['ask_agent', 'post_message'].includes(toolName)) {
    throw new FatalError('Invalid native agent request.')
  }
  await refreshNativeHarnessAccess(access, context, toolName)
  const values = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : {}
  const server = getOverlayServerContext()
  const repository = new ConvexHarnessRepository()
  const childRunIds: string[] = []
  const startTurns = async (args: {
    actorUserId: string
    conversationId: string
    messageId: string
    mentionedPrincipalIds: string[]
    prompt: string
    workspaceId: string
  }) => {
    const invocations = await resolveWorkspaceAgentInvocations(args)
    if (invocations.some(invocation => invocation.externalAgent || invocation.remoteTarget || invocation.harness !== 'overlay')) {
      throw new Error("External agents can't be asked from this run yet.")
    }
    const budgetParent = await repository.get(access)
    if (!budgetParent || budgetParent.workflowRunId !== access.workflowRunId
      || budgetParent.policy.actorUserId !== access.actorUserId || budgetParent.policy.workspaceId !== access.workspaceId) {
      throw new FatalError('Native parent run is no longer available.')
    }
    const remaining = Math.max(0,
      budgetParent.policy.maxCostMicros - budgetParent.usage.costMicros - reservedHarnessCostMicros(budgetParent))
    const childBudget = Math.floor(remaining / (invocations.length + 1))
    const started: Array<{ agentId: string; turnId: string }> = []
    for (const invocation of invocations) {
      const turn = await server.appData.repositories.conversationCollaboration.startAgentTurn({
        actorUserId: access.actorUserId,
        agentId: invocation.agentId,
        authorPrincipalId: invocation.agentPrincipalId,
        clientNonce: invocation.invocationNonce,
        conversationId: args.conversationId,
        initiatorPrincipalId: access.agentPrincipalId,
        modelId: invocation.modelId,
        executionEngine: 'overlay_harness',
        turnId: invocation.turnId,
        userMessageId: args.messageId,
        workspaceId: args.workspaceId,
      })
      try {
        const workflowInput = await buildNativeHarnessWorkflowInput({
          actorUserId: access.actorUserId,
          workspaceId: args.workspaceId,
          conversationId: args.conversationId,
          runId: turn.runId,
          memoryEnabled: false,
        })
        const parent = await repository.get(access)
        if (!parent || parent.workflowRunId !== access.workflowRunId
          || parent.policy.actorUserId !== access.actorUserId || parent.policy.workspaceId !== access.workspaceId) {
          throw new FatalError('Native parent run is no longer available.')
        }
        const allowedToolIds = [...new Set(workflowInput.definitions
          .map(definition => definition.name)
          .filter(name => parent.policy.allowedToolIds.includes(name)))].sort()
        workflowInput.definitions = workflowInput.definitions.filter(definition => allowedToolIds.includes(definition.name))
        const childRunId = `workspace:${turn.runId}`
        const child = {
          id: childRunId,
          stepId: `ask:${toolCallId}:${invocation.agentId}`,
          allowedToolIds,
          maxCostMicros: isFreeTierChatModelId(invocation.modelId) ? 0 : childBudget,
          costMicros: 0,
          status: 'running' as const,
          evidenceRefs: [],
        }
        let admitted = false
        for (let attempt = 0; attempt < 8; attempt++) {
          const state = attempt === 0 ? parent : await repository.get(access)
          if (!state || state.workflowRunId !== access.workflowRunId
            || state.policy.actorUserId !== access.actorUserId || state.policy.workspaceId !== access.workspaceId) {
            throw new FatalError('Native parent run is no longer available.')
          }
          const result = await repository.apply({
            actorUserId: access.actorUserId,
            runId: access.runId,
            operationId: `named-child:${toolCallId}:${invocation.agentId}`,
            expectedRevision: state.revision,
            operation: {
              type: 'admit_named_child',
              child,
              step: {
                title: `Ask ${invocation.agentName}`,
                acceptanceCriteria: [`${invocation.agentName} responds to the request.`],
              },
              goal: args.prompt.slice(0, 32_000),
              constraints: [],
              target: { deliveryAgentRunId: turn.runId, conversationId: args.conversationId },
            },
          })
          if (!result.conflict) {
            const matchingChild = result.snapshot.children.find(entry => entry.id === childRunId)
            if (!matchingChild) throw new FatalError('Named child admission returned no child.')
            admitted = true
            break
          }
        }
        if (!admitted) throw new Error('Named child admission is contended.')
        await startNativeHarnessNamedChild(access, workflowInput, childRunId)
        childRunIds.push(childRunId)
        started.push({ agentId: invocation.agentId, turnId: invocation.turnId })
      } catch (error) {
        await server.appData.repositories.conversationCollaboration.failAgentMessage({
          actorUserId: access.actorUserId,
          conversationId: args.conversationId,
          content: agentStartFailureMessage(invocation.agentName, error),
          messageId: turn.messageId,
          workspaceId: args.workspaceId,
        }).catch((_error) => undefined)
        throw error
      }
    }
    return started
  }

  const caller = { agentId: access.agentId, conversationId: access.conversationId, turnId: access.turnId }
  const actor = { actorUserId: access.actorUserId, actorPrincipalId: access.principalId, workspaceId: access.workspaceId, caller, startTurns }
  if (toolName === 'ask_agent') {
    if (typeof values.agent !== 'string' || typeof values.message !== 'string') throw new FatalError('Invalid ask_agent input.')
    return { ...await server.agentAsks.ask({ ...actor, target: values.agent, message: values.message, wait: false }), childRunIds }
  }
  if (typeof values.conversationId !== 'string' || typeof values.text !== 'string'
    || (values.mentions !== undefined && (!Array.isArray(values.mentions) || values.mentions.some(item => typeof item !== 'string')))) {
    throw new FatalError('Invalid post_message input.')
  }
  return { ...await server.agentAsks.post({
    ...actor,
    conversationId: values.conversationId,
    text: values.text,
    mentions: (values.mentions as string[] | undefined) ?? [],
  }), childRunIds }
}

dispatchNativeHarnessAgentRequest.maxRetries = 0
