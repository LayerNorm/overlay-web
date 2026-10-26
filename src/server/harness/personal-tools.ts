import { jsonSchema, tool, type ToolSet } from 'ai'
import { FatalError } from 'workflow'
import {
  isPersonalChatWorkToolOutputEnvelope,
  type PersonalChatWorkToolDefinition,
  type PersonalChatWorkToolingContext,
} from '@/shared/agents/personal-chat-work'
import {
  executePersonalChatWorkTool,
  personalChatWorkToolNeedsApproval,
} from '@/server/conversations/personal-chat-work-tools'
import { HARNESS_CONTROL_TOOLS } from './context'
import { refreshPersonalHarnessAccess, type PersonalHarnessAccess } from './personal-access'

export type PersonalHarnessToolsInput = {
  access: PersonalHarnessAccess
  context: PersonalChatWorkToolingContext
  definitions: PersonalChatWorkToolDefinition[]
}

async function executeAuthorizedTool(args: {
  access: PersonalHarnessAccess
  context: PersonalChatWorkToolingContext
  toolName: string
  input: unknown
  messages: unknown[]
  toolCallId: string
}) {
  'use step'
  const context = await refreshPersonalHarnessAccess(args.access, args.context, args.toolName)
  return executePersonalChatWorkTool(args.input, {
    context: { ...context, agentRunId: args.access.agentRunId, harnessRunId: args.access.runId, toolName: args.toolName },
    messages: args.messages,
    toolCallId: args.toolCallId,
  })
}

async function toolNeedsApproval(args: {
  access: PersonalHarnessAccess
  context: PersonalChatWorkToolingContext
  toolName: string
  input: unknown
  messages: unknown[]
  toolCallId: string
}) {
  'use step'
  const context = await refreshPersonalHarnessAccess(args.access, args.context, args.toolName)
  return personalChatWorkToolNeedsApproval(args.input, {
    context: { ...context, agentRunId: args.access.agentRunId, toolName: args.toolName },
    messages: args.messages,
    toolCallId: args.toolCallId,
  })
}

export function createPersonalHarnessTools(input: PersonalHarnessToolsInput): ToolSet {
  const tools: ToolSet = {}
  const reserved = new Set<string>(HARNESS_CONTROL_TOOLS)
  for (const definition of [...input.definitions].sort((a, b) => a.name.localeCompare(b.name))) {
    if (reserved.has(definition.name) || Object.hasOwn(tools, definition.name)
      || ['__proto__', 'constructor', 'prototype'].includes(definition.name)) {
      throw new FatalError('Duplicate or reserved harness tool name.')
    }
    const context = { access: input.access, context: input.context, toolName: definition.name }
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
      // Re-evaluate even if admission said no approval was needed.
      needsApproval: async (value, options) => toolNeedsApproval({ ...context, input: value, messages: options.messages, toolCallId: options.toolCallId }),
      execute: async (value, options) => executeAuthorizedTool({ ...context, input: value, messages: options.messages, toolCallId: options.toolCallId }),
      toModelOutput: ({ output }) => isPersonalChatWorkToolOutputEnvelope(output)
        ? output.overlayModelOutput as never
        : typeof output === 'string' ? { type: 'text', value: output } : { type: 'json', value: output as never },
    })
  }
  return tools
}

// Tool side effects have their own idempotency keys. A failed execution is
// returned to the model rather than retried invisibly by the workflow engine.
executeAuthorizedTool.maxRetries = 0
