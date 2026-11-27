import {
  buildAssistantVisualSequence,
  type AssistantVisualBlock,
} from '@overlay/chat-core'
import type { RoomMessageRecord } from './roomMessages'
import { readNativeAgentApproval } from '../../../src/shared/agents/native-agent-approval'
import { readNativeAgentInput } from '../../../src/shared/agents/native-agent-input'

export {
  decodeRunQuestions,
  formatRunAnswers,
} from '../../../src/shared/agents/run-questions'

export function completeMarkdown(text: string, streaming: boolean): string {
  if (!streaming) return text
  let fence: string | null = null
  let offset = 0
  let complete = 0
  for (const line of text.split(/(?<=\n)/)) {
    offset += line.length
    const marker = line.match(/^\s*(`{3,}|~{3,})/)
    if (marker && !fence) fence = marker[1]
    else if (
      marker &&
      fence &&
      marker[1][0] === fence[0] &&
      marker[1].length >= fence.length
    ) {
      fence = null
      if (line.endsWith('\n')) complete = offset
    } else if (!fence && !line.trim() && line.endsWith('\n')) complete = offset
  }
  return text.slice(0, complete)
}

export function agentMessageProjection(message: RoomMessageRecord) {
  const parts = message.parts ?? []
  const approval = parts
    .map((part) =>
      part.type === 'data-native-agent-approval'
        ? readNativeAgentApproval(part.data)
        : undefined,
    )
    .find(Boolean)
  const question = parts
    .map((part) =>
      part.type === 'data-native-agent-input'
        ? readNativeAgentInput(part.data)
        : undefined,
    )
    .find(Boolean)
  const pending = parts.findIndex(
    (part) =>
      part.type === 'data-remote-agent-request' &&
      ['pending', 'decision_pending'].includes(String(part.data?.state)),
  )
  const visible = pending < 0 ? parts : parts.slice(0, pending)
  const display = visible.length
    ? visible
    : [{ type: 'text', text: message.content }]
  const tail = display.findLastIndex(
    (part) =>
      part.type === 'text' ||
      part.type === 'reasoning' ||
      part.type?.startsWith('tool'),
  )
  const chunks = display.map((part, index) =>
    index === tail &&
    part.type === 'text' &&
    message.status === 'generating' &&
    !approval &&
    !question &&
    pending < 0
      ? { ...part, text: completeMarkdown(part.text ?? '', true) }
      : part,
  )
  const blocks: AssistantVisualBlock[] = buildAssistantVisualSequence(chunks)
  return {
    approval,
    question,
    blocks,
    remoteRequest: pending < 0 ? undefined : parts[pending].data,
  }
}
