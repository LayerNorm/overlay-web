import 'server-only'
import { getStepMetadata } from 'workflow'

import { asSchema, jsonSchema, streamText, tool, type ModelMessage } from 'ai'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ActEntitlementService } from '@/server/conversations/ActEntitlementService'
import {
  executePersonalChatWorkToolResult,
  sanitizeWorkflowToolSchemaValue,
} from '@/server/conversations/personal-chat-work-tools'
import { buildWorkspaceAgentTooling } from './agent-tooling'
import {
  buildAgentSystemPrompt,
  loadRoomTurnContext,
  agentModelAttempts,
  reconcileUnverifiedAgentActionClaims,
  type WorkspaceAgentTurnResult,
} from './workspace-agent-invocation'
import { buildAgentTurnContext } from './agent-turn-context'
import { createAgentMessageStream, appendAgentTextPart } from './agent-message-stream'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import { agentMemoryOwnerId } from '@/shared/agents/agent-memory'
import {
  buildAssistantPersistenceFromSteps,
  compactAssistantPersistenceForConvex,
} from '@/shared/chat/persist-assistant-turn'

const MAX_OUTPUT_TOKENS_AGENT = 16_000

export type WorkspaceAgentToolDefinition = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export type WorkspaceAgentPreparedContext = {
  actorUserId: string
  agentId: string
  agentPrincipalId: string
  agentName: string
  instructions: string
  isDefaultMaster: boolean
  conversationId: string
  messageId: string
  turnMessageId: string
  threadRootMessageId?: string
  workspaceId: string
  runId: string
  maxSteps: number
  memoryEnabled: boolean
  modelId: string
  paid: boolean
  runtimeEntitlements: Record<string, unknown>
  reservationId: string | null
  requestFingerprint: string
  invocationNonce: string
  turnId: string
  contextBlock: string
  messages: ModelMessage[]
  toolDefinitions: WorkspaceAgentToolDefinition[]
}

export type WorkspaceAgentModelCall = {
  text: string
  responseMessages: ModelMessage[]
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>
  usage: { inputTokens?: number; outputTokens?: number }
  finishReason: string
  parts: Array<Record<string, unknown>>
  transcriptParts: Array<Record<string, unknown>>
}

export type WorkspaceAgentToolResult = {
  output: unknown
  display: unknown
  error?: string
  refusedApproval?: boolean
}

export async function prepareWorkspaceAgentTurn(input: {
  actorUserId: string
  agentId: string
  conversationId: string
  messageId: string
  memoryEnabled: boolean
  threadRootMessageId?: string
  turnMessageId: string
  workspaceId: string
  runId: string
}): Promise<WorkspaceAgentPreparedContext> {
  'use step'
  const context = await loadRoomTurnContext(input)
  const agent = context.directory.agents.find(candidate => candidate.id === input.agentId)
  if (!agent || agent.archivedAt) throw new Error('The agent is no longer available.')
  const server = getOverlayServerContext()
  const invocationNonce = `agent:${input.messageId}:${input.agentId}`
  const requestFingerprint = hashOperationalIdentifier('workspace-agent-invocation', invocationNonce)
  const entitlementService = new ActEntitlementService({
    repository: server.appData.repositories.conversations,
    usagePolicy: server.chatUsagePolicy,
  })
  let gate: Awaited<ReturnType<ActEntitlementService['gateModelAccess']>> | undefined
  let modelId = agent.modelId
  for (const attempt of agentModelAttempts(agent.modelId)) {
    try {
      gate = await entitlementService.gateModelAccess({
        effectiveModelId: attempt,
        programmaticSubjectId: `agent:${agent.id}`,
        userId: input.actorUserId,
        workspaceId: input.workspaceId,
      })
      modelId = attempt
      break
    } catch (_error) { /* fallback to the next entitled model */ }
  }
  if (!gate) throw new Error('No agent model attempt succeeded')
  const tooling = await buildWorkspaceAgentTooling({
    actorUserId: input.actorUserId,
    agentPrincipalId: agent.principalId,
    conversationId: input.conversationId,
    effectiveModelId: modelId,
    entitlements: gate.runtimeEntitlements,
    grant: { agentId: agent.id, allowedToolIds: agent.allowedToolIds, isDefaultMaster: Boolean(agent.isDefault || agent.name.toLowerCase() === 'overlay') },
    approvalMode: agent.harness === 'overlay' && agent.permissionMode === 'auto' ? 'auto' : 'ask',
    computerApprovalContext: 'work',
    idempotencyKey: invocationNonce,
    latestUserText: context.latestUserText,
    memoryEnabled: input.memoryEnabled,
    paid: gate.paid,
    requestFingerprint,
    turnId: `agent_${input.messageId}_${agent.id}`,
    workspaceId: input.workspaceId,
  })
  const turnContext = await buildAgentTurnContext({
    actorUserId: input.actorUserId,
    agentName: agent.name,
    agentPrincipalId: agent.principalId,
    billingProgrammaticSubjectId: `agent:${agent.id}`,
    channelVisibility: (context.conversation as { channelVisibility?: string | null }).channelVisibility,
    conversationTitle: context.conversation.title,
    conversationType: context.conversationType,
    history: context.history,
    idempotencyKey: `${invocationNonce}:context`,
    latestUserText: context.latestUserText,
    memoryEnabled: input.memoryEnabled,
    participants: context.participants.map(participant => ({ displayName: participant.displayName, principalId: participant.principalId, principalType: participant.principalType })),
    requestFingerprint,
    workspaceId: input.workspaceId,
  })
  const toolDefinitions = await Promise.all(Object.entries(tooling.tools).map(async ([name, definition]) => ({
    name,
    description: typeof definition.description === 'string' ? definition.description : undefined,
    inputSchema: sanitizeWorkflowToolSchemaValue(await asSchema(definition.inputSchema).jsonSchema) as Record<string, unknown>,
  })))
  const reservation = await server.chatUsagePolicy.reserveForAttempt({
    entitlements: gate.runtimeEntitlements,
    estimatedInputTokens: Math.ceil(JSON.stringify(context.history.slice(-24)).length / 4) + 1_000,
    idempotencyKey: invocationNonce,
    maxOutputTokens: MAX_OUTPUT_TOKENS_AGENT,
    modelId,
    operationId: 'workspace.agent.invoke',
    paid: gate.paid,
    requestFingerprint,
    programmaticSubjectId: `agent:${agent.id}`,
    userId: input.actorUserId,
    workspaceId: input.workspaceId,
  })
  if (!reservation.ok) throw new Error('Agent usage is temporarily limited.')
  return {
    actorUserId: input.actorUserId, agentId: agent.id, agentPrincipalId: agent.principalId,
    agentName: agent.name, instructions: agent.instructions, isDefaultMaster: Boolean(agent.isDefault || agent.name.toLowerCase() === 'overlay'),
    conversationId: input.conversationId, messageId: input.messageId, turnMessageId: input.turnMessageId,
    ...(input.threadRootMessageId ? { threadRootMessageId: input.threadRootMessageId } : {}),
    workspaceId: input.workspaceId, runId: input.runId, memoryEnabled: input.memoryEnabled, modelId, paid: gate.paid,
    maxSteps: context.conversationType === 'dm' ? 20 : 8,
    runtimeEntitlements: gate.runtimeEntitlements as unknown as Record<string, unknown>, reservationId: reservation.reservationId,
    requestFingerprint, invocationNonce, turnId: `agent_${input.messageId}_${agent.id}`,
    contextBlock: turnContext.contextBlock, messages: turnContext.messages, toolDefinitions,
  }
}

export async function callWorkspaceAgentModel(input: {
  prepared: WorkspaceAgentPreparedContext
  messages: ModelMessage[]
  baseParts?: Array<Record<string, unknown>>
}): Promise<WorkspaceAgentModelCall> {
  'use step'
  const model = await getLanguageModel(input.prepared.modelId, undefined, input.prepared.actorUserId, { sessionId: input.prepared.conversationId })
  const tools = Object.fromEntries(input.prepared.toolDefinitions.map(definition => [
    definition.name, tool({ description: definition.description, inputSchema: jsonSchema(definition.inputSchema) }),
  ]))
  const result = streamText({
    model, maxOutputTokens: MAX_OUTPUT_TOKENS_AGENT, maxRetries: 0, temperature: 0.4,
    system: buildAgentSystemPrompt({
      agentName: input.prepared.agentName, contextBlock: input.prepared.contextBlock,
      exposedToolIds: input.prepared.toolDefinitions.map(definition => definition.name),
      hasTools: Object.keys(tools).length > 0, instructions: input.prepared.instructions,
      isDefaultMaster: input.prepared.isDefaultMaster,
    }),
    messages: input.messages, tools: Object.keys(tools).length > 0 ? tools : undefined,
  })
  const parts: Array<Record<string, unknown>> = []
  const transcriptParts = [...(input.baseParts ?? [])]
  const stream = createAgentMessageStream({
    actorUserId: input.prepared.actorUserId, authorPrincipalId: input.prepared.agentPrincipalId,
    clientNonce: input.prepared.invocationNonce, conversationId: input.prepared.conversationId,
    existingMessageId: input.prepared.turnMessageId, modelId: input.prepared.modelId,
    store: getOverlayServerContext().appData.repositories.conversationCollaboration,
    ...(input.prepared.threadRootMessageId ? { threadRootMessageId: input.prepared.threadRootMessageId } : {}),
    turnId: input.prepared.turnId, workspaceId: input.prepared.workspaceId,
  })
  let text = ''
  for await (const event of result.fullStream) {
    if (event.type === 'text-delta') {
      text += event.text
      appendAgentTextPart(parts, event.text)
      appendAgentTextPart(transcriptParts, event.text)
      stream.pushText(event.text, transcriptParts)
    }
    if (event.type === 'tool-call') {
      const part = { type: 'tool-invocation', toolInvocation: { toolCallId: event.toolCallId, toolName: event.toolName, state: 'input-available', toolInput: event.input } }
      parts.push(part)
      transcriptParts.push(part)
      stream.pushParts(transcriptParts)
    }
  }
  const [response, toolCalls, usage, finishReason] = await Promise.all([result.response, result.toolCalls, result.usage, result.finishReason])
  await stream.flush()
  return {
    text, parts, transcriptParts, finishReason,
    responseMessages: response.messages,
    toolCalls: toolCalls.map(call => ({ toolCallId: call.toolCallId, toolName: call.toolName, input: call.input })),
    usage: { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens },
  }
}

async function freshWorkspaceTooling(prepared: WorkspaceAgentPreparedContext, toolCallId: string) {
  const context = await loadRoomTurnContext({
    actorUserId: prepared.actorUserId, conversationId: prepared.conversationId,
    messageId: prepared.messageId,
    workspaceId: prepared.workspaceId,
  })
  const agent = context.directory.agents.find(candidate => candidate.id === prepared.agentId)
  if (!agent || agent.archivedAt) return null
  const run = await (getOverlayServerContext().appData.repositories.conversations as import('@/server/conversations/ActConversationRepository').ActConversationRepository).getLatestAgentRun({
    agentRunId: prepared.runId, conversationId: prepared.conversationId as never, userId: prepared.actorUserId,
  })
  if (!run || run.id !== prepared.runId || run.conversationId !== prepared.conversationId || !['running', 'waiting_for_approval'].includes(run.status)) return null
  const gate = await new ActEntitlementService({
    repository: getOverlayServerContext().appData.repositories.conversations,
    usagePolicy: getOverlayServerContext().chatUsagePolicy,
  }).gateModelAccess({ effectiveModelId: prepared.modelId, programmaticSubjectId: `agent:${agent.id}`, userId: prepared.actorUserId, workspaceId: prepared.workspaceId })
  return await buildWorkspaceAgentTooling({
    actorUserId: prepared.actorUserId, agentPrincipalId: agent.principalId, conversationId: prepared.conversationId,
    effectiveModelId: prepared.modelId, entitlements: gate.runtimeEntitlements,
    grant: { agentId: agent.id, allowedToolIds: agent.allowedToolIds, isDefaultMaster: Boolean(agent.isDefault || agent.name.toLowerCase() === 'overlay') },
    approvalMode: agent.harness === 'overlay' && agent.permissionMode === 'auto' ? 'auto' : 'ask',
    computerApprovalContext: 'work',
    idempotencyKey: `${prepared.runId}:${toolCallId}`, latestUserText: context.latestUserText, memoryEnabled: prepared.memoryEnabled,
    paid: gate.paid, requestFingerprint: prepared.requestFingerprint, turnId: prepared.turnId, workspaceId: prepared.workspaceId,
  })
}

export async function inspectWorkspaceAgentTool(input: { prepared: WorkspaceAgentPreparedContext; toolCall: { toolCallId: string; toolName: string; input: unknown } }): Promise<{ available: boolean; needsApproval: boolean }> {
  'use step'
  const tooling = await freshWorkspaceTooling(input.prepared, input.toolCall.toolCallId)
  const definition = tooling?.tools[input.toolCall.toolName]
  if (!definition) return { available: false, needsApproval: false }
  const dynamicApproval = typeof definition.needsApproval === 'function'
    ? await definition.needsApproval(input.toolCall.input as never, { toolCallId: input.toolCall.toolCallId, context: tooling.toolsContext?.[input.toolCall.toolName] } as never)
    : definition.needsApproval === true
  const needsApproval = dynamicApproval || tooling.toolApproval?.({
      toolCall: { toolName: input.toolCall.toolName, input: (input.toolCall.input ?? {}) as Record<string, unknown> },
    }) === 'user-approval'
  return { available: true, needsApproval }
}

export async function executeWorkspaceAgentTool(input: { prepared: WorkspaceAgentPreparedContext; toolCall: { toolCallId: string; toolName: string; input: unknown }; approved: boolean }): Promise<WorkspaceAgentToolResult> {
  'use step'
  const tooling = await freshWorkspaceTooling(input.prepared, input.toolCall.toolCallId)
  const definition = tooling?.tools[input.toolCall.toolName]
  if (!definition || typeof definition.execute !== 'function') return { output: { error: 'This action is no longer authorized.' }, display: { error: 'This action is no longer authorized.' }, error: 'This action is no longer authorized.' }
  const dynamicApproval = typeof definition.needsApproval === 'function'
    ? await definition.needsApproval(input.toolCall.input as never, { toolCallId: input.toolCall.toolCallId, context: tooling?.toolsContext?.[input.toolCall.toolName] } as never)
    : definition.needsApproval === true
  const nowNeedsApproval = dynamicApproval || tooling?.toolApproval?.({
      toolCall: { toolName: input.toolCall.toolName, input: (input.toolCall.input ?? {}) as Record<string, unknown> },
    }) === 'user-approval'
  if (nowNeedsApproval && !input.approved) return { output: { error: 'This action became approval-required before execution.' }, display: { error: 'This action became approval-required before execution.' }, refusedApproval: true }
  if (getStepMetadata().attempt > 1) {
    const output = { error: 'The action outcome is uncertain. This call was not retried.' }
    return { output, display: output, error: output.error }
  }
  let result: unknown
  try {
    result = await executePersonalChatWorkToolResult({
      execute: () => definition.execute!(input.toolCall.input as never, {
        toolCallId: input.toolCall.toolCallId, messages: [], context: tooling?.toolsContext?.[input.toolCall.toolName],
        agentRunId: input.prepared.runId, idempotencyKey: `${input.prepared.runId}:${input.toolCall.toolCallId}`,
      } as never),
      input: input.toolCall.input, toolCallId: input.toolCall.toolCallId,
      toModelOutput: typeof definition.toModelOutput === 'function'
        ? async ({ toolCallId, input: toolInput, output }) => await definition.toModelOutput!({ toolCallId, input: toolInput as never, output: output as never } as never)
        : undefined,
    })
  } catch (error) {
    const output = { error: error instanceof Error ? error.message : 'Tool execution failed.' }
    return { output, display: output, error: output.error }
  }
  const envelope = result && typeof result === 'object' && 'overlayModelOutput' in result
    ? result as { overlayModelOutput: unknown; display?: unknown }
    : undefined
  return { output: envelope?.overlayModelOutput ?? result, display: envelope?.display ?? result }
}

export async function persistWorkspaceAgentToolProgress(input: {
  prepared: WorkspaceAgentPreparedContext
  parts: Array<Record<string, unknown>>
}) {
  'use step'
  await getOverlayServerContext().appData.repositories.conversationCollaboration.appendAgentMessageDelta({
    actorUserId: input.prepared.actorUserId,
    contentDelta: '',
    conversationId: input.prepared.conversationId,
    messageId: input.prepared.turnMessageId,
    parts: input.parts,
    workspaceId: input.prepared.workspaceId,
  })
}

export async function finalizeWorkspaceAgentTurn(input: {
  prepared: WorkspaceAgentPreparedContext
  steps: Array<Record<string, unknown>>
  content: string
  inputTokens: number
  outputTokens: number
}): Promise<WorkspaceAgentTurnResult> {
  'use step'
  const persistence = compactAssistantPersistenceForConvex(reconcileUnverifiedAgentActionClaims(
    buildAssistantPersistenceFromSteps(input.steps as never, input.content),
  ))
  const collaboration = getOverlayServerContext().appData.repositories.conversationCollaboration
  const stream = createAgentMessageStream({
    actorUserId: input.prepared.actorUserId, authorPrincipalId: input.prepared.agentPrincipalId,
    clientNonce: input.prepared.invocationNonce, conversationId: input.prepared.conversationId,
    existingMessageId: input.prepared.turnMessageId, modelId: input.prepared.modelId, store: collaboration,
    turnId: input.prepared.turnId, workspaceId: input.prepared.workspaceId,
  })
  await stream.finalize({ content: persistence.content, parts: persistence.parts, tokens: { input: input.inputTokens, output: input.outputTokens } })
  if (input.prepared.memoryEnabled) {
    await collaboration.enqueueMemoryExtraction({ actorUserId: input.prepared.actorUserId, conversationId: input.prepared.conversationId, memoryOwnerId: agentMemoryOwnerId(input.prepared.agentId), messageId: input.prepared.turnMessageId, targetActor: 'agent', turnId: input.prepared.turnId, workspaceId: input.prepared.workspaceId }).catch((_error) => undefined)
  }
  await getOverlayServerContext().chatUsagePolicy.recordFinishedUsage({ forceFreeTierLimits: !input.prepared.paid, inputTokens: input.inputTokens, modelId: input.prepared.modelId, outputTokens: input.outputTokens, reservationId: input.prepared.reservationId, userId: input.prepared.actorUserId })
  return { content: persistence.content, parts: persistence.parts, modelId: input.prepared.modelId, tokens: { input: input.inputTokens, output: input.outputTokens } }
}

export async function releaseWorkspaceAgentReservation(input: {
  actorUserId: string
  prepared: WorkspaceAgentPreparedContext
}) {
  'use step'
  await getOverlayServerContext().chatUsagePolicy.releaseReservation({
    reservationId: input.prepared.reservationId,
    userId: input.actorUserId,
  })
}
