import { jsonSchema, tool, type ToolSet } from 'ai'
import { FatalError } from 'workflow'
import { isPersonalChatWorkToolOutputEnvelope, type PersonalChatWorkToolDefinition } from '@/shared/agents/personal-chat-work'
import { HARNESS_CONTROL_TOOLS } from './context'
import type { HarnessToolExecutionOptions } from './tool-approvals'

export type HarnessToolCall = {
  toolName: string
  input: unknown
  messages: unknown[]
  toolCallId: string
}

export function createHarnessTools(
  definitions: PersonalChatWorkToolDefinition[],
  adapter: {
    needsApproval: (call: HarnessToolCall) => Promise<boolean>
    execute: (call: HarnessToolCall, approved: boolean) => Promise<unknown>
  },
): ToolSet {
  const tools: ToolSet = {}
  const reserved = new Set<string>(HARNESS_CONTROL_TOOLS)
  for (const definition of [...definitions].sort((a, b) => a.name.localeCompare(b.name))) {
    if (reserved.has(definition.name) || Object.hasOwn(tools, definition.name)
      || ['__proto__', 'constructor', 'prototype'].includes(definition.name)) {
      throw new FatalError('Duplicate or reserved harness tool name.')
    }
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
      needsApproval: async (input, options) => adapter.needsApproval({
        toolName: definition.name, input, messages: options.messages, toolCallId: options.toolCallId,
      }),
      execute: async (input, options: HarnessToolExecutionOptions) => adapter.execute({
        toolName: definition.name, input, messages: options.messages, toolCallId: options.toolCallId,
      }, options.harnessApproved === true),
      toModelOutput: ({ output }) => isPersonalChatWorkToolOutputEnvelope(output)
        ? output.overlayModelOutput as never
        : typeof output === 'string' ? { type: 'text', value: output } : { type: 'json', value: output as never },
    })
  }
  return tools
}
