import 'server-only'

import { createHash } from 'node:crypto'
import { FatalError } from 'workflow'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { buildWorkspaceAgentTooling, type WorkspaceAgentToolingResult } from '@/server/agents/agent-tooling'
import { resolveWorkspaceAgentInvocations } from '@/server/agents/workspace-agent-invocation'
import { agentStartFailureMessage } from '@/server/app-api/v1/conversations/message/agent-start-failure'
import { getOverlayServerContext } from '@/server/bootstrap'
import { buildNativeHarnessWorkflowInput } from './native-workflow-input-builder'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { startNativeHarnessNamedChild } from './native-named-child-launch'
import { executePersonalChatWorkToolResult } from '@/server/conversations/personal-chat-work-tools'
import { refreshNativeHarnessAccess, type NativeHarnessAccess } from './native-access'
import { logger } from '@/server/observability/logger'
import { applyHarnessOperation } from './state-steps'
import { harnessToolOutputEvidence, isToolFailureOutput } from './tool-evidence'
import type { HarnessToolFailure } from '@overlay/agent-runtime/harness-store'
import type { NativeHarnessToolsInput } from './native-tools'
import type { HarnessToolCall } from './tools'
import { nativeToolInputFailure, validateNativeToolInput } from './native-tool-input-validation'
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
      workflowRunId: call.access.workflowRunId,
      operationId: call.toolCallId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      failureCode: 'PROGRESS_PROJECTION_FAILED',
      causeClass: nativeToolExecutionFailure(call, error).causeClass,
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
  const tooling = await freshTooling(call)
  const definition = tooling.tools[call.toolName]
  const validation = await validateNativeToolInput(call.toolName, definition, call.input)
  if (!validation.success) return false
  return needsApproval(tooling, { ...call, input: validation.value })
}

export async function executeNativeHarnessTool(call: NativeToolCall, approved: boolean): Promise<unknown> {
  'use step'
  const initial = await freshTooling(call)
  const initialDefinition = initial.tools[call.toolName]
  const initialValidation = await validateNativeToolInput(call.toolName, initialDefinition, call.input)
  if (!initialValidation.success) return await returnNativeToolInputFailure(call, initialValidation.value)
  const initialCall = { ...call, input: initialValidation.value }
  if (await needsApproval(initial, initialCall) && !approved) throw new FatalError('This native action requires fresh approval.')
  const current = await freshTooling(call)
  const definition = current.tools[call.toolName]
  const currentValidation = await validateNativeToolInput(call.toolName, definition, call.input)
  if (!currentValidation.success) return await returnNativeToolInputFailure(call, currentValidation.value)
  const currentCall = { ...call, input: currentValidation.value }
  if (await needsApproval(current, currentCall) && !approved) throw new FatalError('This native action became approval-required before execution.')
  let result: unknown
  try {
    result = await executeWithNativeHarnessToolProgress(call, () => executePersonalChatWorkToolResult({
      execute: () => definition.execute!(currentValidation.value as never, {
        toolCallId: call.toolCallId, messages: call.messages, context: current.toolsContext?.[call.toolName],
        agentRunId: call.access.agentRunId, logicalStepId: call.toolCallId, idempotencyKey: idempotencyKey(call),
      } as never),
      input: currentValidation.value, toolCallId: call.toolCallId,
      toModelOutput: typeof definition.toModelOutput === 'function'
        ? async args => definition.toModelOutput!(args as never) : undefined,
    }))
  } catch (error) {
    const failure = nativeToolExecutionFailure(call, error)
    await persistNativeToolFailure(call, failure)
    logger.warn('[harness] native tool execution failed', {
      runId: call.access.runId,
      workflowRunId: call.access.workflowRunId,
      operationId: call.toolCallId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      failurePhase: failure.phase,
      causeClass: failure.causeClass,
      causeCode: failure.causeCode,
    })
    throw error
  }
  await recordNativeToolResultEvidence(call, result)
  return result
}

async function returnNativeToolInputFailure(call: NativeToolCall, failure: ReturnType<typeof nativeToolInputFailure>) {
  await persistNativeToolFailure(call, {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    phase: 'pre_dispatch',
    causeClass: 'schema_validation',
    causeCode: 'INVALID_TOOL_INPUT',
    safeSummary: 'Tool input was rejected before execution.',
    validationIssues: failure.issues,
  })
  logger.warn('[harness] native tool input rejected before execution', {
    runId: call.access.runId,
    workflowRunId: call.access.workflowRunId,
    operationId: call.toolCallId,
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    failurePhase: 'pre_dispatch',
    failureCode: failure.code,
  })
  const result = await executeWithNativeHarnessToolProgress(call, async () => failure)
  await recordNativeToolResultEvidence(call, result)
  return result
}

function nativeToolExecutionFailure(call: NativeToolCall, error: unknown): HarnessToolFailure {
  const name = error instanceof Error ? error.name : ''
  const causeClass: HarnessToolFailure['causeClass'] = name === 'AbortError' ? 'abort_error'
    : name === 'ConvexError' ? 'convex_error'
      : name === 'RangeError' ? 'range_error'
        : name === 'TimeoutError' ? 'timeout_error'
          : name === 'TypeError' ? 'type_error'
            : name === 'ZodError' ? 'zod_error'
              : name === 'Error' ? 'error' : 'unknown_error'
  const rawCode = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code : undefined
  const causeCode: HarnessToolFailure['causeCode'] = rawCode === 'ABORT_ERR' || rawCode === 'EAI_AGAIN'
    || rawCode === 'ECONNREFUSED' || rawCode === 'ECONNRESET' || rawCode === 'ENOTFOUND' || rawCode === 'ETIMEDOUT'
    ? rawCode : name === 'ZodError' ? 'ZOD_ERROR_DURING_EXECUTION' : 'TOOL_EXECUTION_FAILED'
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    phase: 'execution',
    causeClass,
    causeCode,
    safeSummary: 'Tool execution failed; its effect may be uncertain.',
  }
}

async function persistNativeToolFailure(call: NativeToolCall, failure: HarnessToolFailure) {
  const operationId = `tool-failure:${createHash('sha256').update(call.toolCallId).digest('hex')}`
  try {
    await applyHarnessOperation(call.access, operationId, { type: 'record_tool_failure', failure })
  } catch (error) {
    const writeFailure = nativeToolExecutionFailure(call, error)
    logger.warn('[harness] native tool failure record write failed', {
      runId: call.access.runId,
      workflowRunId: call.access.workflowRunId,
      operationId: call.toolCallId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      failurePhase: failure.phase,
      failureCode: failure.causeCode,
      writeFailureClass: writeFailure.causeClass,
      writeFailureCode: writeFailure.causeCode,
    })
  }
}

async function recordNativeToolResultEvidence(call: NativeToolCall, result: unknown) {
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
    logger.warn('[harness] native tool evidence write failed', {
      runId: call.access.runId,
      workflowRunId: call.access.workflowRunId,
      operationId: call.toolCallId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      failureCode: 'EVIDENCE_WRITE_FAILED',
      causeClass: nativeToolExecutionFailure(call, error).causeClass,
    })
  }
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
  if (toolName === 'ask_agent') {
    if (typeof values.agent !== 'string' || typeof values.message !== 'string') throw new FatalError('Invalid ask_agent input.')
    const target = values.agent
    const message = values.message
    return executeWithNativeHarnessToolProgress(progressCall, async () => ({
      ...await server.agentAsks.ask({ ...actor, target, message, wait: false }),
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
    }),
    childRunIds,
  }))
}

dispatchNativeHarnessAgentRequest.maxRetries = 0
