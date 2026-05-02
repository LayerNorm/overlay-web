import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { MessageToolPart } from '@overlay/extension-contracts'
import type { ChatStreamingMode } from '../../context/chat-settings'
import { getDescriptiveToolLabel } from '../../lib/tool-labels'
import { MarkdownMessage } from '../MarkdownMessage'
import { ToolLogoColumn } from './OverlayLogo'

function isToolRunning(part: MessageToolPart): boolean {
  return part.state === 'input-streaming' || part.state === 'input-available'
}

export function BrowserSessionToolBlock({
  part,
  connectTop,
  connectBottom,
  streamingMode = 'chunk',
}: {
  part: MessageToolPart
  connectTop: boolean
  connectBottom: boolean
  streamingMode?: ChatStreamingMode
}) {
  const isDone = part.state === 'output-available'
  const isError =
    part.state === 'input-error' || part.state === 'output-error' || part.state === 'output-denied'
  const input = part.input && typeof part.input === 'object' ? (part.input as Record<string, unknown>) : undefined
  const task = typeof input?.task === 'string' ? input.task.trim() : ''
  const output = part.output && typeof part.output === 'object' ? (part.output as Record<string, unknown>) : undefined
  const liveUrl = typeof output?.liveUrl === 'string' ? output.liveUrl : null
  const label = getDescriptiveToolLabel(part.toolName, input)
  const running = isToolRunning(part)
  const hasDetails = Boolean(task || liveUrl)
  const [userExpanded, setUserExpanded] = useState(false)
  const showDetails = (running && Boolean(task)) || (isDone && userExpanded && hasDetails)

  if (isError) {
    return (
      <div className="w-full px-1 py-0.5">
        <div className="flex max-w-[min(100%,36rem)] items-stretch gap-2.5 py-1 text-[13px] leading-snug">
          <ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />
          <span className="min-w-0 flex-1 text-red-600">{label} — couldn’t complete</span>
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
                  aria-label={userExpanded ? 'Collapse browser tool details' : 'Expand browser tool details'}
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
            className={`ml-[26px] overflow-hidden transition-all duration-300 ${
              showDetails ? 'max-h-[520px] pt-2' : 'max-h-0'
            }`}
          >
            {showDetails ? (
              <div key={userExpanded ? 'open' : running ? 'streaming' : 'closed'} className="message-appear space-y-3">
                {task ? (
                  <div className="reasoning-markdown text-[12px] leading-relaxed text-[var(--muted)]">
                    <MarkdownMessage
                      text={task}
                      isStreaming={running}
                      suppressTypingIndicator
                      streamingMode={streamingMode}
                    />
                  </div>
                ) : null}
                {liveUrl && isDone ? (
                  <iframe
                    src={liveUrl}
                    title="Browser task preview"
                    sandbox="allow-scripts allow-same-origin"
                    className="h-[280px] w-full rounded-xl border border-[var(--border)] bg-[var(--background)]"
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
