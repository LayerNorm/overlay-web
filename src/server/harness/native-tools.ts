import type { ToolSet } from 'ai'
import type { PersonalChatWorkToolDefinition } from '@/shared/agents/personal-chat-work'
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
  return createHarnessTools(input.definitions, {
    needsApproval: call => nativeHarnessToolNeedsApproval({ ...context, ...call }),
    execute: (call, approved) => executeNativeHarnessTool({ ...context, ...call }, approved),
  })
}
