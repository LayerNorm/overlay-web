import type { ToolSet } from 'ai'
import type { PersonalChatWorkToolDefinition, PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import { createHarnessTools } from './tools'
import type { PersonalHarnessAccess } from './personal-access'

export type PersonalHarnessToolsInput = {
  access: PersonalHarnessAccess
  context: Omit<PersonalChatWorkToolingContext, 'entitlements' | 'paid'>
  definitions: PersonalChatWorkToolDefinition[]
}

async function executeAuthorizedTool(args: {
  access: PersonalHarnessAccess
  context: PersonalHarnessToolsInput['context']
  toolName: string
  input: unknown
  messages: unknown[]
  toolCallId: string
}) {
  'use step'
  const [{ refreshPersonalHarnessAccess }, { executePersonalChatWorkTool }] = await Promise.all([
    import('./personal-access'),
    import('@/server/conversations/personal-chat-work-tools'),
  ])
  const context = await refreshPersonalHarnessAccess(args.access, args.context, args.toolName)
  return executePersonalChatWorkTool(args.input, {
    context: { ...context, agentRunId: args.access.agentRunId, harnessRunId: args.access.runId, toolName: args.toolName },
    messages: args.messages,
    toolCallId: args.toolCallId,
  })
}

async function toolNeedsApproval(args: {
  access: PersonalHarnessAccess
  context: PersonalHarnessToolsInput['context']
  toolName: string
  input: unknown
  messages: unknown[]
  toolCallId: string
}) {
  'use step'
  const [{ refreshPersonalHarnessAccess }, { personalChatWorkToolNeedsApproval }] = await Promise.all([
    import('./personal-access'),
    import('@/server/conversations/personal-chat-work-tools'),
  ])
  const context = await refreshPersonalHarnessAccess(args.access, args.context, args.toolName)
  return personalChatWorkToolNeedsApproval(args.input, {
    context: { ...context, agentRunId: args.access.agentRunId, toolName: args.toolName },
    messages: args.messages,
    toolCallId: args.toolCallId,
  })
}

export function createPersonalHarnessTools(input: PersonalHarnessToolsInput): ToolSet {
  const context = { access: input.access, context: input.context }
  return createHarnessTools(input.definitions, {
    needsApproval: call => toolNeedsApproval({ ...context, ...call }),
    execute: call => executeAuthorizedTool({ ...context, ...call }),
  })
}

// Tool side effects have their own idempotency keys. A failed execution is
// returned to the model rather than retried invisibly by the workflow engine.
executeAuthorizedTool.maxRetries = 0
