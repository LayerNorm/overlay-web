import type { AgentRemoteEvent } from '@overlay/workspace-contracts'

/** UTF-16 offsets match JS strings on both ends. Event sequence deduplication precedes this projection. */
export function applyRemoteText(content: string, event: AgentRemoteEvent): string {
  if (event.type !== 'text_checkpoint' && event.type !== 'text_delta') return content
  const text = event.payload.text
  if (typeof text !== 'string') throw new Error('AGENT_TEXT_INVALID')
  const offset = event.payload.offset
  if (event.type === 'text_checkpoint' && offset === undefined) return text
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) throw new Error('AGENT_TEXT_INVALID')
  if (event.type === 'text_checkpoint') {
    if (offset > content.length) throw new Error('AGENT_TEXT_OFFSET_MISMATCH')
    // A bounded anchor carries the last 64 KiB, preserving its already committed prefix.
    return content.slice(0, offset) + text
  }
  if (offset === content.length) return content + text
  if (offset < content.length && content.slice(offset, offset + text.length) === text) return content
  throw new Error('AGENT_TEXT_OFFSET_MISMATCH')
}
