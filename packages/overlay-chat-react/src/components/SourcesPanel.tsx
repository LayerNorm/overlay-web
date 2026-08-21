'use client'

import { useEffect } from 'react'
import { Brain, FileText, PanelRightOpen, Maximize2 } from 'lucide-react'
import {
  faviconUrl,
  prettyUrlPath,
  safeHttpUrl,
  webSourceDisplayKey,
  type WebSourceItem,
} from '@overlay/chat-core'
import { AppScreenSidePanel } from '@overlay/modules-react/shell'

/** Whether the panel floats over the page or docks as a right-hand column. */
export type PanelPresentation = 'floating' | 'sidebar'

function PresentationToggle({
  presentation,
  onPresentationChange,
}: {
  presentation: PanelPresentation
  onPresentationChange: (presentation: PanelPresentation) => void
}) {
  const next: PanelPresentation = presentation === 'floating' ? 'sidebar' : 'floating'
  const label = presentation === 'floating' ? 'Dock as side panel' : 'Show as floating panel'
  return (
    <button
      type="button"
      onClick={() => onPresentationChange(next)}
      className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
      aria-label={label}
      title={label}
    >
      {presentation === 'floating'
        ? <PanelRightOpen size={15} strokeWidth={1.75} />
        : <Maximize2 size={15} strokeWidth={1.75} />}
    </button>
  )
}

export function SourcesPanel({
  open,
  onClose,
  onOpenSource,
  sources,
  variant = 'inline',
  presentation,
  onPresentationChange,
}: {
  open: boolean
  onClose: () => void
  onOpenSource?: (url: string) => void
  sources: WebSourceItem[]
  variant?: 'inline' | 'shell'
  presentation?: PanelPresentation
  onPresentationChange?: (presentation: PanelPresentation) => void
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
  const presentationToggle = presentation && onPresentationChange ? (
    <PresentationToggle presentation={presentation} onPresentationChange={onPresentationChange} />
  ) : null
  // Source rows follow the same open-in-Overlay flow as links inside a reply.
  const sourceList = (
    <ul className="flex flex-col gap-1" data-overlay-link-scope="">
      {sources.flatMap((source, idx) => {
        // Knowledge sources are in-app routes, not URLs: they skip the http
        // guard, open in place, and carry a resource icon instead of a favicon.
        const internal = source.origin === 'knowledge'
        const internalHref = source.internalHref ?? source.url
        const safeUrl = internal ? internalHref : safeHttpUrl(source.url)
        if (!safeUrl) return []
        const site = internal
          ? (source.internalKind === 'memory' ? 'Memory' : 'File')
          : webSourceDisplayKey(source.url)
        const fav = internal ? '' : faviconUrl(source.url)
        const titleCandidate = source.title?.trim() || ''
        let host = ''
        if (!internal) {
          try {
            host = new URL(source.url).hostname.replace(/^www\./i, '')
          } catch {
            host = site
          }
        }
        const isTitleJustHost =
          !internal &&
          (!titleCandidate ||
            titleCandidate.toLowerCase() === host.toLowerCase() ||
            titleCandidate.toLowerCase() === site.toLowerCase())
        const displayTitle = internal
          ? titleCandidate || site
          : isTitleJustHost ? host : titleCandidate
        const subtext = internal
          ? source.snippet?.trim() || (source.internalKind === 'memory' ? 'Saved memory' : 'Indexed file')
          : source.snippet?.trim() || (isTitleJustHost ? prettyUrlPath(source.url) : host)
        return (
          <li key={`${source.url}-${idx}`}>
            <a
              href={safeUrl}
              {...(internal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
              onClick={
                onOpenSource && !internal
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
                  {internal ? (
                    source.internalKind === 'memory' ? (
                      <Brain size={12} strokeWidth={1.75} className="text-[var(--muted)]" />
                    ) : (
                      <FileText size={12} strokeWidth={1.75} className="text-[var(--muted)]" />
                    )
                  ) : fav ? (
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
        actions={presentationToggle}
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
      // Floating fades rather than slides, matching AppScreen's floating right
      // panel so the two surfaces appear and disappear the same way.
      className={`absolute inset-y-2 right-2 z-30 hidden w-[min(40vw,380px)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--sidebar-surface)] shadow-xl transition-opacity duration-300 ease-[var(--overlay-ease)] md:flex ${
        open ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <div className="flex h-full w-[min(40vw,380px)] flex-col">
        <AppScreenSidePanel
          title="Sources"
          onClose={onClose}
          closeLabel="Close sources"
          actions={presentationToggle}
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
