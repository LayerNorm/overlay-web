'use client'

import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import type { ReactNode } from 'react'
import { ExternalLink, FolderOpen, PanelRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { LinkOpenPreference } from '@overlay/app-core'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { internalFileIdFromHref } from '@/shared/files/internal-file-link'
import { safeHttpUrl } from '@/shared/security/safe-url'
import { Button, Popover, PopoverAnchor, PopoverContent } from '@overlay/ui'

/**
 * Marks a region whose links participate in the open-in-Overlay flow. Anything
 * outside a marked region (app navigation, settings, marketing pages) keeps the
 * browser's default behaviour.
 */
export const LINK_SCOPE_ATTRIBUTE = 'data-overlay-link-scope'

const CHOOSER_WIDTH = 232

type Choice = { url: string; label: string; x: number; y: number; fileId?: string }

const CHOICE_CLASS = 'h-auto w-full justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-normal text-(--foreground) transition-colors hover:bg-(--surface-subtle)'

function ChoiceButton({ icon, onClick, children }: { icon: ReactNode; onClick(): void; children: ReactNode }) {
  return (
    <Button variant="ghost" type="button" onClick={onClick} className={CHOICE_CLASS}>
      {icon}
      {children}
    </Button>
  )
}

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
 * the right-hand panel instead of a new tab. Links to an Overlay file (its
 * content URL, or its Files or Notes page) get the same choice between the
 * panel beside the conversation and the Files page, when the host can show
 * files beside it (`onOpenFile`).
 *
 * Delegation rather than per-link props: links reach the transcript from
 * markdown, citation chips, source rows, and hover cards (some of which render
 * through portals), and every one of them should behave the same way.
 */
export function LinkOpenInterceptor({
  preference,
  onOpenInOverlay,
  onOpenFile,
}: {
  preference: LinkOpenPreference
  onOpenInOverlay: (url: string, title?: string) => void
  /** Shows an Overlay file beside the conversation. Without it, file links navigate as usual. */
  onOpenFile?: (fileId: string, name: string) => void
}) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const router = useRouter()
  const buildWorkspaceHref = useWorkspaceHref()
  const openInFiles = (fileId: string) => router.push(buildWorkspaceHref(null, `/app/files?file=${encodeURIComponent(fileId)}`))

  const close = useCallback(() => setChoice(null), [])

  const onClick = useEffectEvent((event: MouseEvent) => {
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

      const href = anchor.getAttribute('href') ?? ''
      const fileId = onOpenFile ? internalFileIdFromHref(href, window.location.origin) : null
      if (fileId) {
        event.preventDefault()
        event.stopPropagation()
        const name = anchor.textContent?.trim() || 'File'
        if (preference === 'overlay') onOpenFile!(fileId, name)
        else if (preference === 'new-tab') openInFiles(fileId)
        else setChoice({ url: href, label: name, x: event.clientX, y: event.clientY, fileId })
        return
      }

      const url = safeHttpUrl(href)
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
  })

  useEffect(() => {
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

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

  return (
    <Popover open onOpenChange={(open) => { if (!open) close() }}>
      <PopoverAnchor
        aria-hidden
        className="fixed size-0"
        style={{ left: choice.x, top: choice.y }}
      />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        aria-label="Open link"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const content = event.currentTarget as HTMLElement | null
          content?.querySelector('button')?.focus()
        }}
        style={{ width: CHOOSER_WIDTH }}
        className="z-[451] overflow-hidden p-1 shadow-2xl"
      >
        <p
          className='truncate px-2.5 pb-1 pt-1.5 text-[11px] text-(--muted-light)'
          title={choice.fileId ? choice.label : choice.url}
        >
          {choice.fileId ? choice.label : hostOf(choice.url)}
        </p>
        {choice.fileId ? (
          <>
            <ChoiceButton icon={<PanelRight size={15} strokeWidth={1.75} className="shrink-0 text-(--muted)" />}
              onClick={() => { onOpenFile?.(choice.fileId!, choice.label); close() }}>
              Open in sidebar
            </ChoiceButton>
            <ChoiceButton icon={<FolderOpen size={15} strokeWidth={1.75} className="shrink-0 text-(--muted)" />}
              onClick={() => { openInFiles(choice.fileId!); close() }}>
              Open in Files
            </ChoiceButton>
          </>
        ) : (
          <>
            <ChoiceButton icon={<PanelRight size={15} strokeWidth={1.75} className="shrink-0 text-(--muted)" />}
              onClick={() => { onOpenInOverlay(choice.url, choice.label); close() }}>
              Open in Overlay
            </ChoiceButton>
            <ChoiceButton icon={<ExternalLink size={15} strokeWidth={1.75} className="shrink-0 text-(--muted)" />}
              onClick={() => { openInNewTab(choice.url); close() }}>
              Open in new tab
            </ChoiceButton>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
