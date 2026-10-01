'use client'

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Maximize2, PanelRightOpen, RotateCw } from 'lucide-react'
import { safeHttpUrl } from '@overlay/chat-core'
import { AppScreenSidePanel } from '@overlay/modules-react/shell'
import type { PanelPresentation } from './SourcesPanel'

/** Fallback for a frame that never loads even though the probe allowed it. */
const EMBED_TIMEOUT_MS = 8_000

/**
 * Sandbox for third-party pages. `allow-same-origin` lets the site behave
 * normally on its own origin (Docs and most apps need it); top-level navigation
 * and downloads stay blocked so a framed page can never move the app out from
 * under the user.
 */
const IFRAME_SANDBOX = 'allow-forms allow-modals allow-popups allow-same-origin allow-scripts'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

function PanelIconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
    >
      {children}
    </button>
  )
}

function useEmbedBlocked(
  safeUrl: string | null,
  checkEmbeddable: ((url: string) => Promise<boolean>) | undefined,
  reloadKey: number,
) {
  const [blocked, setBlocked] = useState(false)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!safeUrl) return
    loadedRef.current = false
    let cancelled = false
    const reset = requestAnimationFrame(() => setBlocked(false))

    // Headers are the only reliable signal: a frame blocked by X-Frame-Options
    // still fires `load`, so the timeout below only catches a frame that never
    // loads at all.
    void checkEmbeddable?.(safeUrl).then((embeddable) => {
      if (!cancelled && !embeddable) setBlocked(true)
    }).catch(() => undefined)

    const timer = window.setTimeout(() => {
      if (!cancelled && !loadedRef.current) setBlocked(true)
    }, EMBED_TIMEOUT_MS)

    return () => {
      cancelled = true
      cancelAnimationFrame(reset)
      window.clearTimeout(timer)
    }
  }, [checkEmbeddable, safeUrl, reloadKey])

  return { blocked, loadedRef }
}

function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

function LinkPreviewActions({
  showFrame,
  onReload,
  onOpenInNewTab,
  presentation,
  onPresentationChange,
}: {
  showFrame: boolean
  onReload: () => void
  onOpenInNewTab: () => void
  presentation?: PanelPresentation
  onPresentationChange?: (presentation: PanelPresentation) => void
}) {
  const nextPresentation: PanelPresentation = presentation === 'floating' ? 'sidebar' : 'floating'
  return (
    <>
      {showFrame ? (
        <PanelIconButton label="Reload" onClick={onReload}>
          <RotateCw size={15} strokeWidth={1.75} />
        </PanelIconButton>
      ) : null}
      <PanelIconButton label="Open in new tab" onClick={onOpenInNewTab}>
        <ExternalLink size={15} strokeWidth={1.75} />
      </PanelIconButton>
      {presentation && onPresentationChange ? (
        <PanelIconButton
          label={presentation === 'floating' ? 'Dock as side panel' : 'Show as floating panel'}
          onClick={() => onPresentationChange(nextPresentation)}
        >
          {presentation === 'floating'
            ? <PanelRightOpen size={15} strokeWidth={1.75} />
            : <Maximize2 size={15} strokeWidth={1.75} />}
        </PanelIconButton>
      ) : null}
    </>
  )
}

function LinkPreviewFallback({
  url,
  safeUrl,
  onOpenInNewTab,
  onClose,
}: {
  url: string
  safeUrl: string | null
  onOpenInNewTab: () => void
  onClose: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <div>
        <p className="text-sm font-medium text-[var(--foreground)]">
          {safeUrl ? 'This website can only be opened in a new tab' : 'This link cannot be previewed'}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
          {safeUrl
            ? `${hostOf(url)} does not allow other sites to embed it.`
            : 'Only http and https links open in the panel.'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {safeUrl ? (
          <button
            type="button"
            onClick={onOpenInNewTab}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
          >
            <ExternalLink size={13} strokeWidth={1.75} />
            Open in New Tab
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        >
          Close
        </button>
      </div>
    </div>
  )
}

/**
 * Opens a link inside the app's right-hand panel instead of a browser tab, so
 * reading a source or checking a document does not lose the chat.
 *
 * Sites that refuse to be framed get a plain "open it in a new tab" state
 * instead of a blank frame; `checkEmbeddable` reads their headers, since a
 * blocked frame still fires `load` and cannot be detected from script.
 */
export function LinkPreviewPanel({
  url,
  title,
  onClose,
  presentation,
  onPresentationChange,
  checkEmbeddable,
}: {
  url: string
  title?: string
  onClose: () => void
  presentation?: PanelPresentation
  onPresentationChange?: (presentation: PanelPresentation) => void
  /** Resolves false when the site's headers refuse framing. */
  checkEmbeddable?: (url: string) => Promise<boolean>
}) {
  const safeUrl = safeHttpUrl(url)
  const [reloadKey, setReloadKey] = useState(0)
  const { blocked, loadedRef } = useEmbedBlocked(safeUrl, checkEmbeddable, reloadKey)
  useEscapeToClose(onClose)

  const openInNewTab = () => {
    if (safeUrl) window.open(safeUrl, '_blank', 'noopener,noreferrer')
  }

  const showFrame = safeUrl !== null && !blocked

  return (
    <AppScreenSidePanel
      title={title?.trim() || hostOf(url)}
      description={hostOf(url)}
      onClose={onClose}
      closeLabel="Close link preview"
      bodyClassName="p-0"
      actions={
        <LinkPreviewActions
          showFrame={showFrame}
          onReload={() => setReloadKey((value) => value + 1)}
          onOpenInNewTab={openInNewTab}
          presentation={presentation}
          onPresentationChange={onPresentationChange}
        />
      }
    >
      {showFrame ? (
        <iframe
          key={reloadKey}
          src={safeUrl}
          title={title?.trim() || hostOf(url)}
          className="h-full min-h-0 w-full flex-1 border-0 bg-[var(--surface)]"
          sandbox={IFRAME_SANDBOX}
          referrerPolicy="no-referrer"
          loading="eager"
          onLoad={() => {
            loadedRef.current = true
          }}
        />
      ) : (
        <LinkPreviewFallback
          url={url}
          safeUrl={safeUrl}
          onOpenInNewTab={openInNewTab}
          onClose={onClose}
        />
      )}
    </AppScreenSidePanel>
  )
}
