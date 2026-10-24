'use client'
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'

import { useMemo, useState } from 'react'
import { Check, Linkedin, Link2, X } from 'lucide-react'
import { Dialog, DialogContent } from '@overlay/ui'
import { safeHttpUrl } from '@/shared/security/safe-url'

type Resource = {
  id?: string
  type: 'chat' | 'file' | 'agent'
  title: string
  url?: string
  /** Thumbnail (OG image) url, optional. */
  thumbnailUrl?: string
}

const SOCIAL_BUTTON_BASE =
  'inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#1d9bf0] text-white transition-transform hover:scale-105 active:scale-95'

function buildSocialUrls(url: string, title: string) {
  const encodedUrl = encodeURIComponent(url)
  const encodedTitle = encodeURIComponent(title)
  return {
    x: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    reddit: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`,
  }
}

function XIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2H21l-6.49 7.41L22.5 22h-6.84l-4.83-6.31L5.4 22H2.64l6.94-7.93L1.5 2h6.96l4.4 5.79L18.244 2Zm-1.2 18h1.65L7.05 4H5.3l11.744 16Z" />
    </svg>
  )
}

function RedditIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M22 11.5a2.5 2.5 0 0 0-4.2-1.83A11.7 11.7 0 0 0 12.6 8l.84-3.96 2.78.6a1.7 1.7 0 1 0 .2-1l-3.32-.72a.5.5 0 0 0-.6.38L11.55 8a11.7 11.7 0 0 0-5.34 1.66 2.5 2.5 0 1 0-3 4 4.6 4.6 0 0 0-.05.62c0 3.62 4.16 6.55 9.3 6.55s9.3-2.93 9.3-6.55c0-.21-.02-.42-.05-.62A2.5 2.5 0 0 0 22 11.5ZM7.5 13.5a1.5 1.5 0 1 1 1.5 1.5 1.5 1.5 0 0 1-1.5-1.5Zm8 4.05A6.78 6.78 0 0 1 12 18.6a6.78 6.78 0 0 1-3.5-1.05.5.5 0 1 1 .56-.83 5.85 5.85 0 0 0 5.88 0 .5.5 0 0 1 .56.83ZM15 15a1.5 1.5 0 1 1 1.5-1.5A1.5 1.5 0 0 1 15 15Z" />
    </svg>
  )
}

export function ShareDialog({
  isOpen,
  resource,
  onClose,
}: {
  isOpen: boolean
  resource: Resource | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const socials = useMemo(
    () => (resource?.url ? buildSocialUrls(resource.url, resource.title) : null),
    [resource],
  )

  if (!resource || !socials) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(resource.url ?? '')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const openSocial = (href: string) => {
    const safe = safeHttpUrl(href)
    if (!safe) return
    window.open(safe, '_blank', 'noopener,noreferrer')
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-10080 bg-black/60 p-4"
        aria-labelledby="share-dialog-title"
        className="z-10080 block w-[min(560px,94vw)] gap-0 overflow-hidden rounded-2xl p-0"
      >
        <div className="flex items-start justify-between gap-4 border-b border-(--border) px-6 py-5">
          <div className="min-w-0">
            <h2
              id="share-dialog-title"
              className="truncate text-lg font-semibold text-(--foreground)"
            >
              {resource.title}
            </h2>
            <p className="mt-0.5 text-xs text-(--muted)">
              Anyone with the link can view this {resource.type === 'chat' ? 'conversation' : 'file'}
            </p>
          </div>
          <Button variant="ghost"
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={unstyledButton(`shrink-0 rounded-md p-1 text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
          >
            <X size={18} />
          </Button>
        </div>

        <div className="px-6 py-5">
          {/* Preview card — mirrors the OG thumbnail style so the dialog feels like
              the iMessage/Twitter card the recipient will see. */}
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group block overflow-hidden rounded-xl border border-(--border) transition-colors"
          >
            <div
              className="flex aspect-1200/630 w-full flex-col justify-between bg-linear-to-br from-[#0a0a0a] via-[#111418] to-[#0a0a0a] p-6 text-white"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-base font-bold text-black">
                  o
                </div>
                <div className="text-base font-medium tracking-tight">overlay</div>
              </div>
              <div className="text-2xl font-semibold leading-tight tracking-tight line-clamp-3 sm:text-3xl">
                {resource.title}
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>
                  {resource.type === 'chat' ? 'Shared conversation' : 'Shared file'}
                </span>
                <span>getoverlay.io</span>
              </div>
            </div>
            <div className="bg-(--surface-subtle) px-4 py-3">
              <p className="truncate text-sm font-medium text-(--foreground)">
                {resource.title}
              </p>
              <p className="truncate text-xs text-(--muted)">{resource.url}</p>
            </div>
          </a>

          {/* URL row + copy */}
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-(--border) bg-(--background) px-3 py-2">
            <span className="flex-1 truncate text-xs text-(--muted)" title={resource.url}>
              {resource.url}
            </span>
            <Button variant="primary" size="sm"
              type="button"
              onClick={handleCopy}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          {/* Social row */}
          <div className="mt-6 flex items-center justify-around">
            <Button variant="ghost"
              type="button"
              onClick={handleCopy}
              className={unstyledButton(`flex flex-col items-center gap-2`)}
              aria-label="Copy link"
            >
              <span className={SOCIAL_BUTTON_BASE}>
                {copied ? <Check size={22} /> : <Link2 size={22} />}
              </span>
              <span className="text-[11px] text-(--muted)">
                {copied ? 'Copied' : 'Copy link'}
              </span>
            </Button>
            <Button variant="ghost"
              type="button"
              onClick={() => openSocial(socials.x)}
              className={unstyledButton(`flex flex-col items-center gap-2`)}
              aria-label="Share on X"
            >
              <span className={SOCIAL_BUTTON_BASE}>
                <XIcon />
              </span>
              <span className="text-[11px] text-(--muted)">X</span>
            </Button>
            <Button variant="ghost"
              type="button"
              onClick={() => openSocial(socials.linkedin)}
              className={unstyledButton(`flex flex-col items-center gap-2`)}
              aria-label="Share on LinkedIn"
            >
              <span className={SOCIAL_BUTTON_BASE}>
                <Linkedin size={22} />
              </span>
              <span className="text-[11px] text-(--muted)">LinkedIn</span>
            </Button>
            <Button variant="ghost"
              type="button"
              onClick={() => openSocial(socials.reddit)}
              className={unstyledButton(`flex flex-col items-center gap-2`)}
              aria-label="Share on Reddit"
            >
              <span className={SOCIAL_BUTTON_BASE}>
                <RedditIcon />
              </span>
              <span className="text-[11px] text-(--muted)">Reddit</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
