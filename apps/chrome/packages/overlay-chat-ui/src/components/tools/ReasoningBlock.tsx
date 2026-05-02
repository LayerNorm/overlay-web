import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ChatStreamingMode } from '../../context/chat-settings'
import { MarkdownMessage } from '../MarkdownMessage'
import { ToolLogoColumn } from './OverlayLogo'

export function ReasoningBlock({
  text,
  streaming,
  connectTop,
  connectBottom,
  streamingMode = 'chunk',
}: {
  text: string
  streaming: boolean
  connectTop: boolean
  connectBottom: boolean
  streamingMode?: ChatStreamingMode
}) {
  const [userExpanded, setUserExpanded] = useState(false)
  const hasContent = text.trim().length > 0
  const label = streaming ? 'Thinking' : 'Thought'
  const showDetails = streaming ? hasContent : userExpanded && hasContent

  return (
    <div className="w-full px-1 py-0.5">
      <div className="max-w-[min(100%,36rem)]">
        <div className="flex items-stretch gap-2.5 text-[13px] leading-snug">
          <ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
              <span className={streaming ? 'tool-line-shimmer' : 'text-[var(--tool-line-label)]'}>{label}</span>
              {!streaming && hasContent ? (
                <button
                  type="button"
                  onClick={() => setUserExpanded((open) => !open)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                  aria-label={userExpanded ? 'Collapse reasoning' : 'Expand reasoning'}
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
        {hasContent ? (
          <div
            className={`ml-[26px] overflow-hidden transition-all duration-300 ${
              showDetails ? 'max-h-[1200px] pt-1 pb-2' : 'max-h-0'
            }`}
          >
            {showDetails ? (
              <div className="message-appear reasoning-markdown text-[12px] leading-relaxed text-[var(--muted)]">
                <MarkdownMessage
                  text={text}
                  isStreaming={streaming}
                  suppressTypingIndicator
                  streamingMode={streamingMode}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
