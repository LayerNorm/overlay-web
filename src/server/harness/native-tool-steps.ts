import 'server-only'

import { FatalError } from 'workflow'
import { ConvexError } from 'convex/values'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { buildWorkspaceAgentTooling, type WorkspaceAgentToolingResult } from '@/server/agents/agent-tooling'
import { resolveWorkspaceAgentInvocations } from '@/server/agents/workspace-agent-invocation'
import {
  isAvailableToSharedSurface,
  sharedSurfaceAgentContext,
  type SharedSurfaceAgentContext,
} from '@/server/agents/shared-surface-agent-policy'
import { nativeAgentAssignmentContext } from '@/server/agents/agent-asks/native-assignment-context'
import { parseByoModelId } from '@/shared/agents/agent-model'
import { agentStartFailureMessage } from '@/server/app-api/v1/conversations/message/agent-start-failure'
import { getOverlayServerContext } from '@/server/bootstrap'
import { buildNativeHarnessWorkflowInput } from './native-workflow-input-builder'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { startNativeHarnessNamedChild } from './native-named-child-launch'
import { cancelHarnessWorkflow } from './workflow-cancellation'
import { cancelPersonalHarnessWorkflows } from './personal-cancellation'
import { executePersonalChatWorkToolResult } from '@/server/conversations/personal-chat-work-tools'
import { refreshNativeHarnessAccess, type NativeHarnessAccess } from './native-access'
import { logger } from '@/server/observability/logger'
import { applyHarnessOperation } from './state-steps'
import { harnessToolOutputEvidence, isToolFailureOutput } from './tool-evidence'
import type { NativeHarnessToolsInput } from './native-tools'
import type { HarnessToolCall } from './tools'
import {
  projectNativeHarnessToolProgress,
  type NativeHarnessToolProgress,
} from './native-tool-progress'

type NativeToolCall = HarnessToolCall & Pick<NativeHarnessToolsInput, 'access' | 'context'>

function idempotencyKey(call: NativeToolCall): string {
  if (!call.toolCallId || call.toolCallId.length > 256) throw new FatalError('Invalid native tool call identity.')
  return `harness-run:${call.access.runId}:tool:${call.toolCallId}`
}

async function loadNativeParentRun(
  repository: ConvexHarnessRepository,
  access: NativeHarnessAccess,
): Promise<HarnessSnapshot> {
  const parent = await repository.get(access)
  if (!parent || parent.workflowRunId !== access.workflowRunId
    || parent.policy.actorUserId !== access.actorUserId || parent.policy.workspaceId !== access.workspaceId) {
    throw new FatalError('Native parent run is no longer available.')
  }
  return parent
}

async function loadNativeRootWorkflowRunId(
  repository: ConvexHarnessRepository,
  access: NativeHarnessAccess,
  parent: HarnessSnapshot,
): Promise<string> {
  const root = parent.runId === parent.rootRunId ? parent
    : await repository.get({ actorUserId: access.actorUserId, runId: parent.rootRunId })
  if (!root?.workflowRunId || root.runId !== parent.rootRunId
    || root.policy.actorUserId !== access.actorUserId || root.policy.workspaceId !== access.workspaceId) {
    throw new FatalError('Native root run is no longer available.')
  }
  return root.workflowRunId
}

async function freshTooling(call: NativeToolCall) {
  const authority = await refreshNativeHarnessAccess(call.access, call.context, call.toolName)
  const { agent } = authority
  const tooling = await buildWorkspaceAgentTooling({
    actorUserId: call.access.actorUserId, agentPrincipalId: call.access.agentPrincipalId,
    conversationId: call.access.conversationId, effectiveModelId: call.context.modelId,
    inheritedSharedRoom: authority.sharedRoom,
    entitlements: authority.entitlements, paid: authority.paid,
    grant: { agentId: agent.id, allowedToolIds: agent.allowedToolIds, isDefaultMaster: Boolean(agent.isDefault) },
    approvalMode: agent.permissionMode === 'auto' ? 'auto' : 'ask', computerApprovalContext: 'work',
    idempotencyKey: idempotencyKey(call), latestUserText: authority.latestUserText,
    memoryEnabled: call.context.memoryEnabled, requestFingerprint: call.context.requestFingerprint,
    turnId: call.access.turnId, workspaceId: call.access.workspaceId,
    artifactPublicationAuthority: { kind: 'native', access: call.access, context: call.context },
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

function displayToolResult(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !('overlayModelOutput' in result)) return result
  return (result as { display?: unknown }).display
}

function toolProgressResult(call: NativeToolCall, result: unknown): NativeHarnessToolProgress {
  const output = displayToolResult(result)
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input,
    state: isToolFailureOutput(result) ? 'output-error' : 'output-available',
    output,
  }
}

function toolProgressError(call: NativeToolCall, error: unknown): NativeHarnessToolProgress {
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input,
    state: 'output-error',
    output: { error: error instanceof Error ? error.message : String(error) },
  }
}

async function safelyProjectNativeHarnessToolProgress(
  call: NativeToolCall,
  progress: NativeHarnessToolProgress | (() => NativeHarnessToolProgress),
): Promise<void> {
  try {
    await projectNativeHarnessToolProgress(
      call.access,
      call.context,
      typeof progress === 'function' ? progress() : progress,
    )
  } catch (error) {
    logger.warn('[harness] native tool progress write failed', {
      runId: call.access.runId,
      toolCallId: call.toolCallId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function executeWithNativeHarnessToolProgress<T>(
  call: NativeToolCall,
  execute: () => Promise<T>,
): Promise<T> {
  await safelyProjectNativeHarnessToolProgress(call, {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input,
    state: 'input-available',
  })
  try {
    const result = await execute()
    await safelyProjectNativeHarnessToolProgress(call, () => toolProgressResult(call, result))
    return result
  } catch (error) {
    await safelyProjectNativeHarnessToolProgress(call, () => toolProgressError(call, error))
    throw error
  }
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
  const result = await executeWithNativeHarnessToolProgress(call, () => executePersonalChatWorkToolResult({
    execute: () => definition.execute!(call.input as never, {
      toolCallId: call.toolCallId, messages: call.messages, context: current.toolsContext?.[call.toolName],
      agentRunId: call.access.agentRunId, logicalStepId: call.toolCallId, idempotencyKey: idempotencyKey(call),
    } as never),
    input: call.input, toolCallId: call.toolCallId,
    toModelOutput: typeof definition.toModelOutput === 'function'
      ? async args => definition.toModelOutput!(args as never) : undefined,
  }))
  try {
    await applyHarnessOperation(call.access, `tool-evidence:${call.toolCallId}`, {
      type: 'record_evidence',
      evidence: harnessToolOutputEvidence({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        output: result,
        success: true,
      }, Date.now()),
    })
  } catch (error) {
    // The tool already ran; a failed evidence write must not turn its result into a failure.
    logger.warn('[harness] native tool evidence write failed', { error, runId: call.access.runId, toolName: call.toolName })
  }
  return result
}

executeNativeHarnessTool.maxRetries = 0

async function resolveNativeAssignment(access: NativeHarnessAccess, values: Record<string, unknown>, repository: ConvexHarnessRepository) {
  if (typeof values.assignmentId !== 'string' || typeof values.attemptId !== 'string'
    || !['accept', 'exclude', 'cancel'].includes(String(values.action))
    || (values.reason !== undefined && typeof values.reason !== 'string')) throw new FatalError('Invalid assignment resolution.')
  let resolution: Awaited<ReturnType<ConvexHarnessRepository['resolveAssignment']>>
  try {
    resolution = await repository.resolveAssignment({ actorUserId: access.actorUserId, workspaceId: access.workspaceId,
      parentRunId: access.runId, workflowRunId: access.workflowRunId, executionGeneration: access.executionGeneration ?? 0,
      assignmentId: values.assignmentId, attemptId: values.attemptId, action: values.action as 'accept' | 'exclude' | 'cancel', reason: values.reason as string | undefined })
  } catch (error) {
    const feedback = error instanceof ConvexError ? error.data : null
    if (!feedback || typeof feedback !== 'object' || feedback.code !== 'ASSIGNMENT_RESOLUTION_REJECTED'
      || typeof feedback.error !== 'string' || typeof feedback.hint !== 'string') throw error
    return { success: false, code: feedback.code, error: feedback.error, hint: feedback.hint,
      ...(typeof feedback.currentAttemptId === 'string' ? { currentAttemptId: feedback.currentAttemptId } : {}) }
  }
  for (const workflowRunId of resolution.workflows) await cancelHarnessWorkflow(workflowRunId)
  if (resolution.cancellationRoot) await cancelPersonalHarnessWorkflows(resolution.cancellationRoot)
  return { assignmentId: resolution.assignmentId, attemptId: resolution.attemptId, disposition: resolution.disposition, reason: resolution.reason }
}

function assertNativeAgentRequest(toolCallId: string, toolName: string) {
  if (!toolCallId || toolCallId.length > 256 || !['list_agents', 'ask_agent', 'post_message', 'resolve_assignment'].includes(toolName)) {
    throw new FatalError('Invalid native agent request.')
  }
}

async function assertNativeAskTargetAccess(
  server: ReturnType<typeof getOverlayServerContext>,
  actorUserId: string,
  workspaceId: string,
  target: string,
  sharedSurfaceContext: SharedSurfaceAgentContext | undefined,
): Promise<void> {
  const directory = await server.workspaceAgentService.list({ actorUserId, workspaceId })
  const normalizedTarget = target.trim().toLocaleLowerCase()
  const targetAgent = directory.agents.find(agent => agent.id === target.trim()
    || agent.name.trim().toLocaleLowerCase() === normalizedTarget)
  if (!targetAgent || (sharedSurfaceContext && !isAvailableToSharedSurface(targetAgent))) return

  const [remoteTarget, bindings] = await Promise.all([
    server.appData.repositories.connectedAgents.findInvocationTarget({
      workspaceId,
      agentId: targetAgent.id,
      now: Date.now(),
      onlineWithinMs: 45_000,
    }),
    server.appData.repositories.connectedAgents.listBindings({ workspaceId, agentId: targetAgent.id }),
  ])
  if (targetAgent.harness !== 'overlay' || parseByoModelId(targetAgent.modelId) !== null
    || remoteTarget || bindings.length > 0) {
    throw new FatalError("External agents can't be asked from this run yet.")
  }
}

function nativeSurfaceTriggerForRoot(
  surfaceExecution: Awaited<ReturnType<typeof refreshNativeHarnessAccess>>['surfaceExecution'],
  access: NativeHarnessAccess,
  parent: HarnessSnapshot,
) {
  return surfaceExecution && parent.runId === parent.rootRunId
    && access.runId === surfaceExecution.harnessRunId && parent.workflowRunId === surfaceExecution.workflowRunId
    ? surfaceExecution
    : undefined
}

export async function dispatchNativeHarnessAgentRequest(
  access: NativeHarnessToolsInput['access'],
  context: NativeHarnessToolsInput['context'],
  toolCallId: string,
  toolName: string,
  input: unknown,
): Promise<unknown> {
  'use step'
  assertNativeAgentRequest(toolCallId, toolName)
  const authority = await refreshNativeHarnessAccess(access, context, toolName)
  const sharedSurfaceContext = sharedSurfaceAgentContext(authority.surfaceExecution, authority.sharedRoom)
  const values = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : {}
  const server = getOverlayServerContext()
  const repository = new ConvexHarnessRepository()
  if (toolName === 'resolve_assignment') {
    return await resolveNativeAssignment(access, values, repository)
  }
  const childRunIds: string[] = []
  const startTurns = async (args: {
    actorUserId: string
    conversationId: string
    messageId: string
    mentionedPrincipalIds: string[]
    prompt: string
    workspaceId: string
  }) => {
    const invocations = await resolveWorkspaceAgentInvocations(args, { sharedSurfaceContext })
    if (invocations.some(invocation => invocation.externalAgent || invocation.remoteTarget || invocation.harness !== 'overlay')) {
      throw new Error("External agents can't be asked from this run yet.")
    }
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
        const parent = await loadNativeParentRun(repository, access)
        const expectedSurfaceWorkflowRunId = await loadNativeRootWorkflowRunId(repository, access, parent)
        const workflowInput = await buildNativeHarnessWorkflowInput({
          actorUserId: access.actorUserId,
          workspaceId: args.workspaceId,
          conversationId: args.conversationId,
          runId: turn.runId,
          parentRunId: parent.runId,
          memoryEnabled: false,
          surfaceRootRunId: parent.rootRunId,
          expectedSurfaceWorkflowRunId,
        })
        const allowedToolIds = [...new Set(workflowInput.definitions
          .map(definition => definition.name)
          .filter(name => parent.policy.allowedToolIds.includes(name)))].sort()
        workflowInput.definitions = workflowInput.definitions.filter(definition => allowedToolIds.includes(definition.name))
        const childRunId = `workspace:${turn.runId}`
        const child = {
          id: childRunId,
          stepId: `ask:${toolCallId}:${invocation.agentId}`,
          allowedToolIds,
          maxCostMicros: 0,
          costMicros: 0,
          status: 'running' as const,
          evidenceRefs: [],
        }
        let admitted = false
        for (let attempt = 0; attempt < 8; attempt++) {
          const state = attempt === 0 ? parent : await loadNativeParentRun(repository, access)
          const result = await repository.apply({
            actorUserId: access.actorUserId,
            runId: access.runId,
            workflowRunId: access.workflowRunId,
            executionGeneration: access.executionGeneration ?? 0,
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
  const progressCall: NativeToolCall = {
    access,
    context,
    messages: [],
    toolCallId,
    toolName,
    input,
  }
  if (toolName === 'list_agents') {
    return executeWithNativeHarnessToolProgress(progressCall, async () => ({
      success: true,
      agents: await server.agentAsks.list({
        actorUserId: access.actorUserId,
        workspaceId: access.workspaceId,
        callerAgentId: access.agentId,
        sharedSurfaceContext,
      }),
    }))
  }
  if (toolName === 'ask_agent') {
    if (typeof values.agent !== 'string' || typeof values.message !== 'string') throw new FatalError('Invalid ask_agent input.')
    if ((values.assignmentId !== undefined && typeof values.assignmentId !== 'string')
      || (values.expectedAttemptId !== undefined && typeof values.expectedAttemptId !== 'string')) throw new FatalError('Invalid assignment revision input.')
    const target = values.agent
    const message = values.message
    await assertNativeAskTargetAccess(server, access.actorUserId, access.workspaceId, target, sharedSurfaceContext)
    const parent = await loadNativeParentRun(repository, access)
    const nativeSurfaceTrigger = nativeSurfaceTriggerForRoot(authority.surfaceExecution, access, parent)
    return executeWithNativeHarnessToolProgress(progressCall, async () => ({
      ...await server.agentAsks.ask({
        ...actor,
        target,
        message,
        assignmentId: typeof values.assignmentId === 'string' ? values.assignmentId : undefined,
        expectedAttemptId: typeof values.expectedAttemptId === 'string' ? values.expectedAttemptId : undefined,
        wait: false,
        nativeAssignment: nativeAgentAssignmentContext({
          parentConversationId: access.conversationId,
          parentRunId: access.runId,
          rootRunId: parent.rootRunId,
          toolCallId,
        }),
        nativeSurfaceTrigger,
        sharedSurfaceContext,
      }),
      childRunIds,
    }))
  }
  if (typeof values.conversationId !== 'string' || typeof values.text !== 'string'
    || (values.mentions !== undefined && (!Array.isArray(values.mentions) || values.mentions.some(item => typeof item !== 'string')))) {
    throw new FatalError('Invalid post_message input.')
  }
  const conversationId = values.conversationId
  const text = values.text
  const mentions = (values.mentions as string[] | undefined) ?? []
  return executeWithNativeHarnessToolProgress(progressCall, async () => ({
    ...await server.agentAsks.post({
      ...actor,
      conversationId,
      text,
      mentions,
      sharedSurfaceContext,
    }),
    childRunIds,
  }))
}

dispatchNativeHarnessAgentRequest.maxRetries = 0
