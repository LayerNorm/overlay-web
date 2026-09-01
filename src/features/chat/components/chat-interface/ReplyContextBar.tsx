'use client'

import { Reply, X } from 'lucide-react'
import type { ComposerViewProps } from '../ChatComposerTypes'

export function ReplyContextBar({ replyContext, setReplyContext }: Pick<ComposerViewProps, 'replyContext' | 'setReplyContext'>) {
  if (!replyContext) return null
  return (
    <div className="flex items-start gap-2 rounded-t-2xl border-b border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5 text-xs text-[var(--muted)]">
      <Reply size={14} className="mt-0.5 shrink-0 text-[var(--muted)]" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[var(--foreground)]">Replying to prior response</p>
        <p className="mt-0.5 line-clamp-2 text-[var(--muted)]">{replyContext.snippet}</p>
      </div>
      <button type="button" onClick={() => setReplyContext(null)} className="shrink-0 rounded-md p-1 text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]" aria-label="Cancel reply">
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  )
}
