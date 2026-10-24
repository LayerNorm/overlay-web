import type { ToolVisualBlock } from '@overlay/chat-core'
import {
ASSISTANT_COLLAPSIBLE_BODY_CLASS,
TOOL_UI_DONE_STATES
} from '@overlay/chat-core'
import { useState } from 'react'
import { getDescriptiveToolLabel } from '../../lib/tool-labels'

import { TraceStep } from './trace-step'

function extractMemoryContents(name: string, toolInput?: Record<string, unknown>): string[] {
  if (!toolInput) return []
  if (name === 'save_memory' || name === 'update_memory') {
    const c = toolInput.content
    return typeof c === 'string' && c.trim() ? [c.trim()] : []
  }
  if (name === 'save_memory_batch') {
    const arr = toolInput.memories
    if (!Array.isArray(arr)) return []
    const out: string[] = []
    for (const m of arr) {
      if (m && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string') {
        const s = ((m as { content: string }).content).trim()
        if (s) out.push(s)
      }
    }
    return out
  }
  return []
}

function MemoryDetails({ contents }: { contents: string[] }) {
  return (
    <ul className={`max-h-[min(42vh,304px)] space-y-1 pb-1 ${ASSISTANT_COLLAPSIBLE_BODY_CLASS} pr-1 scrollbar-thin`}>
      {contents.map((c, i) => (
        // Append-only tool output; index is the stable identity.
        // react-doctor-disable-next-line react-doctor/no-array-index-as-key
        <li key={i} className="text-[12px] leading-relaxed text-(--muted)">
          {c}
        </li>
      ))}
    </ul>
  )
}

export function MemoryToolBlock({
  block,
}: {
  block: ToolVisualBlock
  connectTop?: boolean
  connectBottom?: boolean
}) {
  const isDone = TOOL_UI_DONE_STATES.has(block.state)
  const isError = block.state === 'output-error' || block.state === 'output-denied'
  const running = !isDone && !isError
  const contents = extractMemoryContents(block.name, block.toolInput)
  const baseLabel = getDescriptiveToolLabel(block.name, block.toolInput)
  const label = contents.length > 1 ? `Saving ${contents.length} memories` : baseLabel
  const [userExpanded, setUserExpanded] = useState(false)

  if (isError) {
    return <TraceStep label={`${baseLabel}, couldn’t complete`} running={false} error />
  }

  return (
    <TraceStep
      label={label}
      running={running}
      open={userExpanded}
      onOpenChange={setUserExpanded}
      expandLabel={userExpanded ? 'Collapse saved memories' : 'Expand saved memories'}
    >
      {contents.length > 0 ? <MemoryDetails contents={contents} /> : null}
    </TraceStep>
  )
}
