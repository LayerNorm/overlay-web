import type { ToolVisualBlock,WebSourceItem } from '@overlay/chat-core'
import {
ASSISTANT_COLLAPSIBLE_BODY_CLASS,
collectWebSourcesFromSingleBlock,
faviconUrl,
hostFromUrl
} from '@overlay/chat-core'
import { Search } from 'lucide-react'
import { useMemo,useState } from 'react'
import { safeHttpUrl } from '../../lib/safe-url'
import { getDescriptiveToolLabel,pickFirstStringFromInput } from '../../lib/tool-labels'
import { webSourceDisplayKey } from '../../lib/web-sources'

import { TraceStep } from './trace-step'

/** Web search as a Trace step: open with the query and top sources while it runs, then collapsed. */
export function WebSearchToolBlock({
  block,
}: {
  block: ToolVisualBlock
  connectTop?: boolean
  connectBottom?: boolean
}) {
  const isDone = block.state === 'output-available'
  const isError = block.state === 'output-error' || block.state === 'output-denied'
  const running = !isDone && !isError
  const queryRaw =
    pickFirstStringFromInput(block.toolInput, ['query', 'q', 'objective']) ?? ''
  const query = queryRaw.trim()
  const label = getDescriptiveToolLabel(block.name, block.toolInput)
  const [userExpanded, setUserExpanded] = useState(false)
  const sources = useMemo(() => collectWebSourcesFromSingleBlock(block), [block])
  const hasDetails = !isError && (query.length > 0 || sources.length > 0)
  return (
    <TraceStep
      label={isError ? `${label}, couldn’t complete` : label}
      running={running}
      error={isError}
      open={running || userExpanded}
      onOpenChange={(open) => {
        if (!running) setUserExpanded(open)
      }}
      expandLabel={running ? undefined : userExpanded ? 'Collapse web search details' : 'Expand web search details'}
    >
      {hasDetails ? <WebSearchToolDetails query={query} sources={sources} /> : null}
    </TraceStep>
  )
}

function WebSearchToolDetails({
  query,
  sources,
}: {
  query: string
  sources: WebSourceItem[]
}) {
  const visibleSources = sources.slice(0, 3)
  const extraCount = Math.max(0, sources.length - visibleSources.length)
  return (
    <div className={`flex max-h-[min(42vh,304px)] flex-col gap-1.5 pb-1 ${ASSISTANT_COLLAPSIBLE_BODY_CLASS} scrollbar-thin`}>
      {query ? (
        <div className="flex min-w-0 items-center gap-2 text-[12px] leading-snug text-(--muted)">
          <Search size={12} strokeWidth={1.75} className="shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0 truncate">{query}</span>
        </div>
      ) : null}
      {visibleSources.length > 0 ? (
        <ul className="flex flex-col">
          {visibleSources.map((source) => (
            <WebSearchSourceRow key={source.url} source={source} />
          ))}
        </ul>
      ) : null}
      {extraCount > 0 ? (
        <div className="text-[12px] text-(--muted) opacity-70">+{extraCount} more</div>
      ) : null}
    </div>
  )
}

function WebSearchSourceRow({ source }: { source: WebSourceItem }) {
  const safeUrl = safeHttpUrl(source.url)
  if (!safeUrl) return null
  const site = webSourceDisplayKey(source.url)
  const fav = faviconUrl(source.url)
  const host = hostFromUrl(source.url) || site
  const titleCandidate = source.title?.trim() || ''
  const isTitleJustHost =
    !titleCandidate ||
    titleCandidate.toLowerCase() === host.toLowerCase() ||
    titleCandidate.toLowerCase() === site.toLowerCase()
  const displayTitle = isTitleJustHost ? host : titleCandidate
  return (
    <li>
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex min-w-0 items-center gap-2 rounded-md py-0.5 text-[12px] leading-snug transition-colors hover:text-(--foreground)"
      >
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-(--surface-subtle)">
          {fav ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fav} alt="" className="h-3 w-3" width={12} height={12} />
          ) : (
            <span className="text-[8px] font-semibold text-(--muted)">
              {site.charAt(0).toUpperCase()}
            </span>
          )}
        </span>
        <span className="min-w-0 truncate text-(--muted) group-hover:text-(--foreground)">
          {displayTitle}
        </span>
        <span className="shrink-0 text-[11px] text-(--muted) opacity-60">{site}</span>
      </a>
    </li>
  )
}
