import type { ToolVisualBlock } from '@overlay/chat-core'
import {
ASSISTANT_COLLAPSIBLE_BODY_CLASS,
TOOL_UI_DONE_STATES
} from '@overlay/chat-core'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { getDescriptiveToolLabel } from '../../lib/tool-labels'

import { ToolLogoColumn } from './tool-rail'

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

export function MemoryToolBlock({
  block,
  connectTop,
  connectBottom,
}: {
  block: ToolVisualBlock
  connectTop: boolean
  connectBottom: boolean
}) {
  const isDone = TOOL_UI_DONE_STATES.has(block.state)
  const isError = block.state === 'output-error' || block.state === 'output-denied'
  const running = !isDone && !isError
  const contents = extractMemoryContents(block.name, block.toolInput)
  const hasDetails = contents.length > 0
  const baseLabel = getDescriptiveToolLabel(block.name, block.toolInput)
  const label = contents.length > 1 ? `Saving ${contents.length} memories` : baseLabel
  const [userExpanded, setUserExpanded] = useState(false)
  const showDetails = isDone && userExpanded && hasDetails

  if (isError) {
    return (
      <div className="w-full px-1 py-0.5">
        <div className="flex max-w-[min(100%,36rem)] items-stretch gap-2.5 py-1 text-[13px] leading-snug">
          <ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />
          <span className="min-w-0 flex-1 text-red-600">{baseLabel} — couldn’t complete</span>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full px-1 py-0.5">
      <div className="max-w-[min(100%,36rem)]">
        <div className="flex items-stretch gap-2.5 text-[13px] leading-snug">
          <ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={running ? 'tool-line-shimmer' : 'text-[var(--tool-line-label)]'}>{label}</span>
              {hasDetails && isDone ? (
                <button
                  type="button"
                  onClick={() => setUserExpanded((open) => !open)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                  aria-label={userExpanded ? 'Collapse saved memories' : 'Expand saved memories'}
                >
                  <ChevronDown
                    size={14}
                    strokeWidth={1.75}
                    className={`transition-transform duration-200 ${userExpanded ? 'rotate-180' : ''}`}
                  />
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {hasDetails ? (
          <div
            className={`ml-[26px] overflow-hidden transition-[max-height] duration-300 ${
              showDetails ? 'max-h-[min(42vh,304px)] pt-2' : 'max-h-0'
            }`}
          >
            {showDetails ? (
              <ul className={`message-appear space-y-1 ${ASSISTANT_COLLAPSIBLE_BODY_CLASS} pr-1 [scrollbar-width:thin]`}>
                {contents.map((c, i) => (
                  <li
                    key={i}
                    className="text-[12px] leading-relaxed text-[var(--muted)]"
                  >
                    {c}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
