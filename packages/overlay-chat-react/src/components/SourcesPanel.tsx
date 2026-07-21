'use client'

import { useEffect } from 'react'
import {
  faviconUrl,
  prettyUrlPath,
  safeHttpUrl,
  webSourceDisplayKey,
  type WebSourceItem,
} from '@overlay/chat-core'
import { AppScreenSidePanel } from '@overlay/modules-react/shell'

export function SourcesPanel({
  open,
  onClose,
  onOpenSource,
  sources,
  variant = 'inline',
}: {
  open: boolean
  onClose: () => void
  onOpenSource?: (url: string) => void
  sources: WebSourceItem[]
  variant?: 'inline' | 'shell'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const shellPanel = variant === 'shell'
  const sourceList = (
    <ul className="flex flex-col gap-1">
      {sources.flatMap((source, idx) => {
        const safeUrl = safeHttpUrl(source.url)
        if (!safeUrl) return []
        const site = webSourceDisplayKey(source.url)
        const fav = faviconUrl(source.url)
        const titleCandidate = source.title?.trim() || ''
        let host = ''
        try {
          host = new URL(source.url).hostname.replace(/^www\./i, '')
        } catch {
          host = site
        }
        const isTitleJustHost =
          !titleCandidate ||
          titleCandidate.toLowerCase() === host.toLowerCase() ||
          titleCandidate.toLowerCase() === site.toLowerCase()
        const displayTitle = isTitleJustHost ? host : titleCandidate
        const subtext =
          source.snippet?.trim() ||
          (isTitleJustHost ? prettyUrlPath(source.url) : host)
        return (
          <li key={`${source.url}-${idx}`}>
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={
                onOpenSource
                  ? (event) => {
                      event.preventDefault()
                      onOpenSource(safeUrl)
                    }
                  : undefined
              }
              className="group block rounded-lg px-2 py-2 transition-colors hover:bg-[var(--surface-subtle)]"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--surface-elevated)] ring-1 ring-[var(--border)]">
                  {fav ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fav} alt="" className="h-3.5 w-3.5" width={14} height={14} />
                  ) : (
                    <span className="text-[9px] font-semibold text-[var(--muted)]">
                      {site.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium leading-snug text-[var(--foreground)] group-hover:underline">
                    {displayTitle}
                  </p>
                  {subtext ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--muted)]">
                      {subtext}
                    </p>
                  ) : null}
                </div>
              </div>
            </a>
          </li>
        )
      })}
    </ul>
  )

  if (shellPanel) {
    return (
      <AppScreenSidePanel
        title="Sources"
        onClose={onClose}
        closeLabel="Close sources"
        aria-label="Sources"
        aria-hidden={!open}
        compactHeader
        className="bg-[var(--sidebar-surface)]"
        bodyClassName="overflow-y-auto px-3 py-3"
      >
        {sourceList}
      </AppScreenSidePanel>
    )
  }

  return (
    <aside
      aria-label="Sources"
      aria-hidden={!open}
      className={`absolute inset-y-2 right-2 z-30 hidden w-[min(40vw,380px)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--sidebar-surface)] shadow-xl transition-[transform,opacity] duration-300 ease-[var(--overlay-ease)] md:flex ${
        open
          ? 'translate-x-0 opacity-100'
          : 'pointer-events-none translate-x-[calc(100%+0.5rem)] opacity-0'
      }`}
    >
      <div className="flex h-full w-[min(40vw,380px)] flex-col">
        <AppScreenSidePanel
          title="Sources"
          onClose={onClose}
          closeLabel="Close sources"
          compactHeader
          className="bg-[var(--sidebar-surface)]"
          bodyClassName="overflow-y-auto px-3 py-3"
        >
          {sourceList}
        </AppScreenSidePanel>
      </div>
    </aside>
  )
}
