import { ASSISTANT_COLLAPSIBLE_BODY_CLASS } from '@overlay/chat-core'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from '@overlay/ui/ai'
import { useEffect, useRef, useState } from 'react'
import { MarkdownMessage } from '../MarkdownMessage'

import { TraceMark } from './tool-rail'

/**
 * Reasoning as a Trace step: open while the reasoning streams (rendered through
 * `MarkdownMessage`, like the reply), then collapsed to "Thought" with a chevron.
 */
export function ReasoningBlock({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
  connectTop?: boolean
  connectBottom?: boolean
}) {
  const [userExpanded, setUserExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [text, streaming])
  const hasContent = text.trim().length > 0
  const line = (
    <TraceLine status={streaming ? 'running' : undefined}>
      <TraceMark running={streaming} />
      <TraceTitle>{streaming ? 'Thinking' : 'Thought'}</TraceTitle>
    </TraceLine>
  )

  if (!hasContent) {
    return <Trace className="px-1 py-1 text-[13px] leading-snug">{line}</Trace>
  }

  return (
    <Trace className="px-1 py-0.5">
      <TraceCollapsible
        open={streaming || userExpanded}
        onOpenChange={(open) => {
          if (!streaming) setUserExpanded(open)
        }}
      >
        <TraceCollapsibleTrigger
          className="py-1 text-[13px] leading-snug"
          aria-label={streaming ? undefined : userExpanded ? 'Collapse reasoning' : 'Expand reasoning'}
        >
          {line}
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="max-w-[min(100%,36rem)]">
          <div
            ref={scrollRef}
            className={`reasoning-markdown max-h-[min(42vh,304px)] overflow-y-auto text-[12px] leading-relaxed text-(--muted) ${ASSISTANT_COLLAPSIBLE_BODY_CLASS} ${streaming ? 'scrollbar-none' : 'scrollbar-thin'}`}
          >
            <MarkdownMessage text={text} isStreaming={streaming} suppressTypingIndicator />
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
