import React, { useRef, useState, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { WebSourceItem } from '../lib/web-sources'
import { webSourceDisplayKey } from '../lib/web-sources'

const SHOW_DELAY_MS = 200
const HIDE_GRACE_MS = 120
const GAP_PX = 6

function faviconUrl(pageUrl: string): string {
  try {
    const host = new URL(pageUrl).hostname
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`
  } catch {
    return ''
  }
}

function hostOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./i, '')
  } catch {
    return webSourceDisplayKey(pageUrl)
  }
}

/**
 * Rich hover tooltip that lists one or more `WebSourceItem`s in a card
 * (favicon + title + host), mirroring Perplexity/ChatGPT citation previews.
 *
 * Rendered in a portal so parent overflow (e.g. messages container, sidebars)
 * cannot clip it. The wrapper is `inline` so it fits inline alongside text
 * without forcing a line break for adjacent chips / markdown runs.
 *
 * Small hide-grace prevents flicker when the cursor moves from the anchor
 * into the tooltip card (for the "open source in new tab" affordance).
 */
export function WebSourceTooltip({
  sources,
  children,
  className,
}: {
  sources: WebSourceItem[]
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; transform: string } | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const showTimerRef = useRef<number | null>(null)
  const hideTimerRef = useRef<number | null>(null)

  function clearTimers() {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  function scheduleShow() {
    clearTimers()
    showTimerRef.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS)
  }

  function scheduleHide() {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
    hideTimerRef.current = window.setTimeout(() => {
      setOpen(false)
      setCoords(null)
    }, HIDE_GRACE_MS)
  }

  useLayoutEffect(() => {
    if (!open) return
    function update() {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      const approxCardHeight = Math.min(64 + sources.length * 40, 220)
      const preferAbove = r.top > approxCardHeight + GAP_PX || r.top > vh - r.bottom
      if (preferAbove) {
        setCoords({
          top: r.top - GAP_PX,
          left: r.left,
          transform: 'translateY(-100%)',
        })
      } else {
        setCoords({
          top: r.bottom + GAP_PX,
          left: r.left,
          transform: 'translateY(0)',
        })
      }
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, sources.length])

  const tooltip =
    open && coords && typeof document !== 'undefined'
      ? createPortal(
          <div
            role="tooltip"
            onMouseEnter={() => {
              if (hideTimerRef.current != null) {
                window.clearTimeout(hideTimerRef.current)
                hideTimerRef.current = null
              }
            }}
            onMouseLeave={scheduleHide}
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              transform: coords.transform,
              zIndex: 400,
              width: 'min(calc(100vw - 16px), 22rem)',
            }}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-2 shadow-lg"
          >
            <div className="px-2 pb-1.5 pt-0.5 text-[11px] font-medium text-[var(--muted)]">
              {sources.length === 1 ? '1 source' : `${sources.length} sources`}
            </div>
            <ul className="flex flex-col gap-0.5">
              {sources.map((source, i) => {
                const host = hostOf(source.url)
                const shortHost = webSourceDisplayKey(source.url)
                const fav = faviconUrl(source.url)
                const isTitleJustHost =
                  !source.title?.trim() ||
                  source.title.trim().toLowerCase() === host.toLowerCase() ||
                  source.title.trim().toLowerCase() === shortHost.toLowerCase()
                const titleText = isTitleJustHost ? host : source.title.trim()
                return (
                  <li key={`${source.url}-${i}`}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--surface-subtle)]"
                    >
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--surface-subtle)] ring-1 ring-[var(--border)]">
                        {fav ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={fav} alt="" className="h-3.5 w-3.5" width={14} height={14} />
                        ) : (
                          <span className="text-[9px] font-semibold text-[var(--muted)]">
                            {shortHost.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--foreground)]">
                        {titleText}
                      </span>
                      <span className="shrink-0 truncate text-[11px] text-[var(--muted)]" style={{ maxWidth: '40%' }}>
                        {shortHost}
                      </span>
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>,
          document.body,
        )
      : null

  return (
    <span
      ref={anchorRef}
      className={className ? `relative ${className}` : 'relative inline'}
      onMouseEnter={scheduleShow}
      onMouseLeave={scheduleHide}
      onFocus={scheduleShow}
      onBlur={scheduleHide}
    >
      {children}
      {tooltip}
    </span>
  )
}
