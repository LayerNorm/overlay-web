import type { AssistantVisualBlock } from '@overlay/chat-core'
import type { StreamChunk } from '../services/aiService'
import { completeMarkdown } from './agentThread'

export function appendPersonalBlock(blocks: AssistantVisualBlock[], chunk: StreamChunk): AssistantVisualBlock[] {
  const next = [...blocks]
  const last = next.at(-1)
  if (chunk.type === 'text') {
    if (last?.kind === 'text') next[next.length - 1] = { ...last, text: last.text + chunk.content }
    else next.push({ kind: 'text', text: chunk.content })
  } else if (chunk.type === 'reasoning') {
    if (last?.kind === 'reasoning') next[next.length - 1] = { ...last, text: last.text + chunk.content }
    else next.push({ kind: 'reasoning', key: `reasoning-${next.length}`, text: chunk.content })
  } else if (chunk.type === 'tool') {
    const index = next.findIndex(block => block.kind === 'tool' && block.key === chunk.toolCallId)
    const previous = index >= 0 ? next[index] : undefined
    const tool = { kind: 'tool' as const, key: chunk.toolCallId ?? `tool-${next.length}`, name: chunk.toolName ?? (previous?.kind === 'tool' ? previous.name : 'Tool'), state: chunk.state ?? 'input-available', toolInput: chunk.input as Record<string, unknown> | undefined, toolOutput: chunk.output ?? (chunk.state === 'output-error' ? { error: chunk.content } : undefined) }
    if (previous?.kind === 'tool') next[index] = { ...previous, ...tool, toolInput: tool.toolInput ?? previous.toolInput, toolOutput: tool.toolOutput ?? previous.toolOutput }
    else next.push(tool)
  } else if (chunk.type === 'file' && chunk.url) next.push({ kind: 'file', url: chunk.url, mediaType: chunk.mediaType })
  return next
}

export function completePersonalBlocks(blocks: AssistantVisualBlock[], streaming: boolean): AssistantVisualBlock[] {
  const last = blocks.length - 1
  return blocks.map((block, index) => index === last && block.kind === 'text' ? { ...block, text: completeMarkdown(block.text, streaming) } : block)
}
