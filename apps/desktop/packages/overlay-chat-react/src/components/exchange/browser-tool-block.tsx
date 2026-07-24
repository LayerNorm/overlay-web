import type { ToolVisualBlock } from '@overlay/chat-core'
import { ASSISTANT_COLLAPSIBLE_BODY_CLASS,isOverlayGatedToolOutput } from '@overlay/chat-core'
import { ChevronDown } from 'lucide-react'
import { useEffect,useRef,useState,type RefObject } from 'react'
import { getDescriptiveToolLabel } from '../../lib/tool-labels'
import { MarkdownMessage } from '../MarkdownMessage'
import { GatedPaidFeatureCallout } from './tool-call-rows'
import { ToolLogoColumn } from './tool-rail'

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

function BrowserToolErrorRow({
  label,
  connectTop,
  connectBottom,
}: {
  label: string
  connectTop: boolean
  connectBottom: boolean
}) {
  return (
    <div className="w-full px-1 py-0.5">
      <div className="flex max-w-[min(100%,36rem)] items-stretch gap-2.5 py-1 text-[13px] leading-snug">
        <ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />
        <span className="min-w-0 flex-1 text-red-600">{label} — couldn’t complete</span>
      </div>
    </div>
  )
}

function BrowserToolHeader({
  details,
  userExpanded,
  onExpandedChange,
  connectTop,
  connectBottom,
}: {
  details: BrowserToolDetailsState
  userExpanded: boolean
  onExpandedChange: (expanded: boolean) => void
  connectTop: boolean
  connectBottom: boolean
}) {
  return (
    <div className="flex items-stretch gap-2.5 text-[13px] leading-snug">
      <ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={details.running ? 'tool-line-shimmer' : 'text-[var(--tool-line-label)]'}>
            {details.label}
          </span>
          {details.hasDetails && details.isDone ? (
            <button
              type="button"
              onClick={() => onExpandedChange(!userExpanded)}
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
  )
}

function BrowserToolDetailsPanel({
  details,
  showDetails,
  userExpanded,
  scrollRef,
}: {
  details: BrowserToolDetailsState
  showDetails: boolean
  userExpanded: boolean
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  if (!details.hasDetails) return null

  return (
    <div
      className={`ml-[26px] overflow-hidden transition-[max-height] duration-300 ${
        showDetails ? 'max-h-[min(42vh,304px)] pt-2' : 'max-h-0'
      }`}
    >
      {showDetails ? (
        <div
          ref={scrollRef}
          key={userExpanded ? 'open' : details.running ? 'streaming' : 'closed'}
          className={`space-y-3 message-appear ${ASSISTANT_COLLAPSIBLE_BODY_CLASS} ${
            details.running ? '[scrollbar-width:none]' : '[scrollbar-width:thin]'
          }`}
        >
          {details.task ? (
            <div className="reasoning-markdown text-[12px] leading-relaxed text-[var(--muted)]">
              <MarkdownMessage text={details.task} isStreaming={details.running} suppressTypingIndicator />
            </div>
          ) : null}
          {details.liveUrl && details.isDone ? (
            <iframe
              src={details.liveUrl}
              title="Browser Use live browser"
              sandbox="allow-scripts allow-same-origin"
              className="h-[280px] w-full rounded-xl border border-[var(--border)] bg-[var(--background)]"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function BrowserToolBlock({
  block,
  connectTop,
  connectBottom,
}: {
  block: ToolVisualBlock
  connectTop: boolean
  connectBottom: boolean
}) {
  const details = getBrowserToolDetails(block)
  const [userExpanded, setUserExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const showDetails = (details.running && Boolean(details.task)) || (details.isDone && userExpanded && details.hasDetails)

  useEffect(() => {
    if (details.running && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [details.task, details.running])

  if (isOverlayGatedToolOutput(block.toolOutput)) {
    return <GatedPaidFeatureCallout block={block} connectTop={connectTop} connectBottom={connectBottom} />
  }

  if (details.isError) {
    return <BrowserToolErrorRow label={details.label} connectTop={connectTop} connectBottom={connectBottom} />
  }

  return (
    <div className="w-full px-1 py-0.5">
      <div className="max-w-[min(100%,36rem)]">
        <BrowserToolHeader
          details={details}
          userExpanded={userExpanded}
          onExpandedChange={setUserExpanded}
          connectTop={connectTop}
          connectBottom={connectBottom}
        />
        <BrowserToolDetailsPanel
          details={details}
          showDetails={showDetails}
          userExpanded={userExpanded}
          scrollRef={scrollRef}
        />
      </div>
    </div>
  )
}
