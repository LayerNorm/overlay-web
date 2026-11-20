import {
  TOOL_UI_DONE_STATES,
  buildAssistantVisualSequence,
  describeToolCall,
  redactCommand,
  type ToolVisualBlock,
} from '@overlay/chat-core'

import type { RoomTranscriptMessage as ActivityMessage } from '@/components/providers/RoomTranscriptProvider'
import { NATIVE_AGENT_INPUT_PART, readNativeAgentInput } from '@/shared/agents/native-agent-input'

export type ThreadPlan = {
  steps: ReadonlyArray<{ id: string; title: string; status: string }>
  phase: 'active' | 'waiting' | 'ended'
}

export type ThreadCommand = {
  key: string
  command: string
  output: string
  exitCode: number | null
  running: boolean
}

export type ThreadEdit = { path: string; added: number; removed: number }

export type ThreadActivity = {
  plan: ThreadPlan | null
  calls: ToolVisualBlock[]
  commands: ThreadCommand[]
  edits: ThreadEdit[]
}

function planPhase(message: ActivityMessage): ThreadPlan['phase'] {
  if (message.status !== 'generating') return 'ended'
  const asks = message.parts?.some((part) => {
    const { type, data } = part as { type?: string; data?: unknown }
    return type === NATIVE_AGENT_INPUT_PART && readNativeAgentInput(data) !== undefined
  })
  return asks ? 'waiting' : 'active'
}

const isAgent = (message: ActivityMessage) => message.authorKind === 'agent' || message.authorKind === 'model'

function commandOf(call: ToolVisualBlock): ThreadCommand | null {
  if (call.name !== 'computer_exec' || typeof call.toolInput?.command !== 'string') return null
  const output = call.toolOutput && typeof call.toolOutput === 'object' ? call.toolOutput as Record<string, unknown> : {}
  const text = [output.stdout, output.stderr, output.error].filter((part): part is string => typeof part === 'string' && part.length > 0)
  return {
    key: call.key,
    command: redactCommand(call.toolInput.command),
    output: text.map((part) => part.replace(/\n+$/, '')).join('\n'),
    exitCode: typeof output.exitCode === 'number' ? output.exitCode : null,
    running: !TOOL_UI_DONE_STATES.has(call.state),
  }
}

/**
 * What an agent thread did, read from its transcript: the newest plan, every tool call in order, the
 * commands it ran on its computer and the files it changed with line counts.
 */
export function threadActivity(messages: readonly ActivityMessage[]): ThreadActivity {
  const agentMessages = messages.filter(isAgent)
  const planned = agentMessages.findLast((message) => message.agentPlan?.length)
  const calls = agentMessages.flatMap((message) =>
    buildAssistantVisualSequence(message.parts).filter((block): block is ToolVisualBlock => block.kind === 'tool'))
  const edits = new Map<string, ThreadEdit>()
  for (const call of calls) {
    if (call.state !== 'output-available') continue
    const description = describeToolCall(call.name, call.toolInput, call.toolOutput, 'complete')
    const path = description?.title ?? description?.target
    if (!description || !path || (description.added === undefined && description.removed === undefined)) continue
    const edit = edits.get(path) ?? { path, added: 0, removed: 0 }
    edits.set(path, { path, added: edit.added + (description.added ?? 0), removed: edit.removed + (description.removed ?? 0) })
  }
  return {
    plan: planned?.agentPlan ? { steps: planned.agentPlan, phase: planPhase(planned) } : null,
    calls,
    commands: calls.flatMap((call) => commandOf(call) ?? []),
    edits: [...edits.values()],
  }
}
