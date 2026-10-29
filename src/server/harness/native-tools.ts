import type { ToolSet } from 'ai'
import type { PersonalChatWorkToolDefinition } from '@/shared/agents/personal-chat-work'
import type { NativeHarnessAccess, NativeHarnessContext } from './native-access'
import { dispatchNativeHarnessAgentRequest, executeNativeHarnessTool, nativeHarnessToolNeedsApproval } from './native-tool-steps'
import { createHarnessTools } from './tools'

export type NativeHarnessToolsInput = {
  access: NativeHarnessAccess
  context: NativeHarnessContext
  definitions: PersonalChatWorkToolDefinition[]
}

export function createNativeHarnessTools(input: NativeHarnessToolsInput): ToolSet {
  const context = { access: input.access, context: input.context }
  const agentRequestTools = new Set(['ask_agent', 'post_message'])
  return createHarnessTools(input.definitions, {
    needsApproval: call => agentRequestTools.has(call.toolName)
      ? Promise.resolve(false)
      : nativeHarnessToolNeedsApproval({ ...context, ...call }),
    execute: (call, approved) => agentRequestTools.has(call.toolName)
      ? dispatchNativeHarnessAgentRequest(input.access, input.context, call.toolCallId, call.toolName, call.input)
      : executeNativeHarnessTool({ ...context, ...call }, approved),
  })
}
