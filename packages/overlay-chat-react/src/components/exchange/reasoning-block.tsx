import {
ASSISTANT_COLLAPSIBLE_BODY_CLASS
} from '@overlay/chat-core'
import { ChevronDown } from 'lucide-react'
import { useEffect,useRef,useState } from 'react'
import { MarkdownMessage } from '../MarkdownMessage'

import { ToolLogoColumn } from './tool-rail'

export function ReasoningBlock({
  text,
  streaming,
  connectTop,
  connectBottom,
}: {
  text: string
  streaming: boolean
  connectTop: boolean
  connectBottom: boolean
}) {
  const [userExpanded, setUserExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [text, streaming])
  const hasContent = text.trim().length > 0
  const label = streaming ? 'Thinking' : 'Thought'
  const showDetails = streaming ? hasContent : userExpanded && hasContent

  return (
    <div className="w-full px-1 py-0.5">
      <div className="max-w-[min(100%,36rem)]">
        <div className="flex items-stretch gap-2.5 py-1 text-[13px] leading-snug">
          <ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={streaming ? 'tool-line-shimmer' : 'text-[var(--tool-line-label)]'}>
                {label}
              </span>
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
            className={`ml-[26px] overflow-hidden transition-[max-height] duration-300 ${
              showDetails ? 'max-h-[min(42vh,304px)] pt-1 pb-2' : 'max-h-0'
            }`}
          >
            {showDetails ? (
              <div
                ref={scrollRef}
                className={`message-appear reasoning-markdown text-[12px] leading-relaxed text-[var(--muted)] ${ASSISTANT_COLLAPSIBLE_BODY_CLASS} ${streaming ? '[scrollbar-width:none]' : '[scrollbar-width:thin]'}`}
              >
                <MarkdownMessage
                  text={text}
                  isStreaming={streaming}
                  suppressTypingIndicator
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Web search tool: shows the query and the top sources in a compact list (favicon + title + host),
 * inspired by Perplexity/ChatGPT search previews. While the tool runs we auto-expand the details;
 * once it finishes we collapse to a single row and the user can click the chevron to re-open.
 */
