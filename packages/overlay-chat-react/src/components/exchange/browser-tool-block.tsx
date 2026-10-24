import type { ToolVisualBlock } from '@overlay/chat-core'
import { ASSISTANT_COLLAPSIBLE_BODY_CLASS,isOverlayGatedToolOutput } from '@overlay/chat-core'
import { useEffect,useRef,useState,type RefObject } from 'react'
import { getDescriptiveToolLabel } from '../../lib/tool-labels'
import { MarkdownMessage } from '../MarkdownMessage'
import { GatedPaidFeatureCallout } from './tool-call-rows'
import { TraceStep } from './trace-step'

type BrowserToolDetailsState = {
  isDone: boolean
  isError: boolean
  running: boolean
  task: string
  liveUrl: string | null
  label: string
  hasDetails: boolean
}

function getBrowserToolDetails(block: ToolVisualBlock): BrowserToolDetailsState {
  const isDone = block.state === 'output-available'
  const isError = block.state === 'output-error' || block.state === 'output-denied'
  const task = typeof block.toolInput?.task === 'string' ? block.toolInput.task.trim() : ''
  const toolOutput =
    block.toolOutput && typeof block.toolOutput === 'object'
      ? (block.toolOutput as Record<string, unknown>)
      : undefined
  const liveUrl = typeof toolOutput?.liveUrl === 'string' ? toolOutput.liveUrl : null

  return {
    isDone,
    isError,
    running: !isDone && !isError,
    task,
    liveUrl,
    label: getDescriptiveToolLabel('interactive_browser_session', block.toolInput),
    hasDetails: Boolean(task || liveUrl),
  }
}

function BrowserToolDetailsPanel({
  details,
  scrollRef,
}: {
  details: BrowserToolDetailsState
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={scrollRef}
      className={`max-h-[min(42vh,304px)] space-y-3 pb-1 ${ASSISTANT_COLLAPSIBLE_BODY_CLASS} ${
        details.running ? 'scrollbar-none' : 'scrollbar-thin'
      }`}
    >
      {details.task ? (
        <div className="reasoning-markdown text-[12px] leading-relaxed text-(--muted)">
          <MarkdownMessage text={details.task} isStreaming={details.running} suppressTypingIndicator />
        </div>
      ) : null}
      {details.liveUrl && details.isDone ? (
        <iframe
          src={details.liveUrl}
          title="Browser Use live browser"
          sandbox="allow-scripts"
          className="h-[280px] w-full rounded-xl bg-(--surface-subtle)"
        />
      ) : null}
    </div>
  )
}

export function BrowserToolBlock({
  block,
}: {
  block: ToolVisualBlock
  connectTop?: boolean
  connectBottom?: boolean
}) {
  const details = getBrowserToolDetails(block)
  const [userExpanded, setUserExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (details.running && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [details.task, details.running])

  if (isOverlayGatedToolOutput(block.toolOutput)) {
    return <GatedPaidFeatureCallout block={block} />
  }

  if (details.isError) {
    return <TraceStep label={`${details.label}, couldn’t complete`} running={false} error />
  }

  return (
    <TraceStep
      label={details.label}
      running={details.running}
      open={(details.running && Boolean(details.task)) || (details.isDone && userExpanded)}
      onOpenChange={(open) => {
        if (!details.running) setUserExpanded(open)
      }}
      expandLabel={details.running ? undefined : userExpanded ? 'Collapse browser tool details' : 'Expand browser tool details'}
    >
      {details.hasDetails ? <BrowserToolDetailsPanel details={details} scrollRef={scrollRef} /> : null}
    </TraceStep>
  )
}
