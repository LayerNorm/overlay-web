import type { ToolSet } from 'ai'
import type { PersonalChatWorkToolDefinition } from '@/shared/agents/personal-chat-work'
import { harnessDispatchRequiredOutput } from '@/shared/agents/harness-dispatch-refusal'
import type { NativeHarnessAccess, NativeHarnessContext } from './native-access'
import { executeNativeHarnessTool, nativeHarnessToolNeedsApproval } from './native-tool-steps'
import { createHarnessTools } from './tools'

export type NativeHarnessToolsInput = {
  access: NativeHarnessAccess
  context: NativeHarnessContext
  definitions: PersonalChatWorkToolDefinition[]
}

export function createNativeHarnessTools(input: NativeHarnessToolsInput): ToolSet {
  const context = { access: input.access, context: input.context }
  const refusedTools = new Set(['ask_agent', 'post_message'])
  return createHarnessTools(input.definitions, {
    needsApproval: call => refusedTools.has(call.toolName)
      ? Promise.resolve(false)
      : nativeHarnessToolNeedsApproval({ ...context, ...call }),
    execute: (call, approved) => refusedTools.has(call.toolName)
      ? Promise.resolve(harnessDispatchRequiredOutput)
      : executeNativeHarnessTool({ ...context, ...call }, approved),
  })
}
