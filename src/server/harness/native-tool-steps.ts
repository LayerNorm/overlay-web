import 'server-only'

import { FatalError } from 'workflow'
import { buildWorkspaceAgentTooling, type WorkspaceAgentToolingResult } from '@/server/agents/agent-tooling'
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
