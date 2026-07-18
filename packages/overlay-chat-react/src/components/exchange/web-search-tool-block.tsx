import type { ToolVisualBlock } from '@overlay/chat-core'
import {
ASSISTANT_COLLAPSIBLE_BODY_CLASS,
collectWebSourcesFromSingleBlock,
faviconUrl,
hostFromUrl
} from '@overlay/chat-core'
import { ChevronDown,Search } from 'lucide-react'
import { useMemo,useState } from 'react'
import { safeHttpUrl } from '../../lib/safe-url'
import { getDescriptiveToolLabel,pickFirstStringFromInput } from '../../lib/tool-labels'
import { webSourceDisplayKey } from '../../lib/web-sources'

import { ToolLogoColumn } from './tool-rail'

export function WebSearchToolBlock({
  block,
  connectTop,
  connectBottom,
}: {
  block: ToolVisualBlock
  connectTop: boolean
  connectBottom: boolean
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
  const visibleSources = sources.slice(0, 3)
  const extraCount = Math.max(0, sources.length - visibleSources.length)
  const hasDetails = query.length > 0 || sources.length > 0
  const showDetails =
    (running && hasDetails) || (isDone && userExpanded && hasDetails)

  if (isError) {
    return (
      <div className="w-full px-1 py-0.5">
        <div className="flex max-w-[min(100%,36rem)] items-stretch gap-2.5 py-0.5 text-[13px] leading-snug">
          <ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />
          <span className="min-w-0 flex-1 text-red-600">{label} — couldn’t complete</span>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full px-1 py-0.5">
      <div className="max-w-[min(100%,36rem)]">
        <div className="flex items-stretch gap-2.5 py-0.5 text-[13px] leading-snug">
          <ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />
          <div className="min-w-0 flex-1">
            <div className="flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1">
              <span className={running ? 'tool-line-shimmer' : 'text-[var(--tool-line-label)]'}>
                {label}
              </span>
              {hasDetails && isDone ? (
                <button
                  type="button"
                  onClick={() => setUserExpanded((open) => !open)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                  aria-label={userExpanded ? 'Collapse web search details' : 'Expand web search details'}
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
              showDetails ? 'max-h-[min(42vh,304px)] pt-1 pb-2' : 'max-h-0'
            }`}
          >
            {showDetails ? (
              <div className={`message-appear flex flex-col gap-1.5 ${ASSISTANT_COLLAPSIBLE_BODY_CLASS} [scrollbar-width:thin]`}>
                {query ? (
                  <div className="flex min-w-0 items-center gap-2 text-[12px] leading-snug text-[var(--muted)]">
                    <Search size={12} strokeWidth={1.75} className="shrink-0 opacity-70" aria-hidden />
                    <span className="min-w-0 truncate">{query}</span>
                  </div>
                ) : null}
                {visibleSources.length > 0 ? (
                  <ul className="flex flex-col">
                    {visibleSources.flatMap((source, idx) => {
                      const safeUrl = safeHttpUrl(source.url)
                      if (!safeUrl) return []
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
                        <li key={`${source.url}-${idx}`}>
                          <a
                            href={safeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex min-w-0 items-center gap-2 rounded-md py-0.5 text-[12px] leading-snug transition-colors hover:text-[var(--foreground)]"
                          >
                            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--surface-elevated)] ring-1 ring-[var(--border)]">
                              {fav ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={fav} alt="" className="h-3 w-3" width={12} height={12} />
                              ) : (
                                <span className="text-[8px] font-semibold text-[var(--muted)]">
                                  {site.charAt(0).toUpperCase()}
                                </span>
                              )}
                            </span>
                            <span className="min-w-0 truncate text-[var(--muted)] group-hover:text-[var(--foreground)]">
                              {displayTitle}
                            </span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)] opacity-60">{site}</span>
                          </a>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
                {extraCount > 0 ? (
                  <div className="text-[12px] text-[var(--muted)] opacity-70">+{extraCount} more</div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
