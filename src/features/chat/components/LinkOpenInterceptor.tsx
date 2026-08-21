'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, PanelRight } from 'lucide-react'
import type { LinkOpenPreference } from '@overlay/app-core'
import { safeHttpUrl } from '@/shared/security/safe-url'

/**
 * Marks a region whose links participate in the open-in-Overlay flow. Anything
 * outside a marked region (app navigation, settings, marketing pages) keeps the
 * browser's default behaviour.
 */
export const LINK_SCOPE_ATTRIBUTE = 'data-overlay-link-scope'

const CHOOSER_WIDTH = 232

type Choice = { url: string; label: string; x: number; y: number }

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

function openInNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Intercepts clicks on external links inside chat responses so they can open in
 * the right-hand panel instead of a new tab.
 *
 * Delegation rather than per-link props: links reach the transcript from
 * markdown, citation chips, source rows, and hover cards (some of which render
 * through portals), and every one of them should behave the same way.
 */
export function LinkOpenInterceptor({
  preference,
  onOpenInOverlay,
}: {
  preference: LinkOpenPreference
  onOpenInOverlay: (url: string, title?: string) => void
}) {
  const [choice, setChoice] = useState<Choice | null>(null)

  const close = useCallback(() => setChoice(null), [])

  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Leave the browser's own affordances alone: modified clicks, middle
      // clicks, and anything already handled by another listener.
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a')
      if (!anchor) return
      if (!anchor.closest(`[${LINK_SCOPE_ATTRIBUTE}]`)) return
      if (anchor.hasAttribute('download')) return

      const url = safeHttpUrl(anchor.getAttribute('href') ?? '')
      if (!url) return

      event.preventDefault()
      event.stopPropagation()

      const label = anchor.textContent?.trim() || hostOf(url)
      if (preference === 'overlay') {
        onOpenInOverlay(url, label)
        return
      }
      if (preference === 'new-tab') {
        openInNewTab(url)
        return
      }
      setChoice({ url, label, x: event.clientX, y: event.clientY })
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [onOpenInOverlay, preference])

  useEffect(() => {
    if (!choice) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onScroll = () => close()
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [choice, close])

  if (!choice || typeof document === 'undefined') return null

  const left = Math.min(Math.max(8, choice.x), window.innerWidth - CHOOSER_WIDTH - 8)
  const top = Math.min(choice.y + 8, window.innerHeight - 132)

  return createPortal(
    <>
      <div className="fixed inset-0 z-[450]" onMouseDown={close} />
      <div
        role="dialog"
        aria-label="Open link"
        style={{ position: 'fixed', top, left, width: CHOOSER_WIDTH, zIndex: 451 }}
        className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-1 shadow-2xl"
      >
        <p className="truncate px-2.5 pb-1 pt-1.5 text-[11px] text-[var(--muted-light)]" title={choice.url}>
          {hostOf(choice.url)}
        </p>
        <button
          type="button"
          onClick={() => {
            onOpenInOverlay(choice.url, choice.label)
            close()
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
        >
          <PanelRight size={15} strokeWidth={1.75} className="shrink-0 text-[var(--muted)]" />
          Open in Overlay
        </button>
        <button
          type="button"
          onClick={() => {
            openInNewTab(choice.url)
            close()
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
        >
          <ExternalLink size={15} strokeWidth={1.75} className="shrink-0 text-[var(--muted)]" />
          Open in new tab
        </button>
      </div>
    </>,
    document.body,
  )
}
