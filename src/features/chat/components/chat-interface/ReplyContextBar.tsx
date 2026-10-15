'use client'

import { Reply, X } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import type { ComposerViewProps } from '../ChatComposerTypes'

export function ReplyContextBar({ replyContext, setReplyContext }: Pick<ComposerViewProps, 'replyContext' | 'setReplyContext'>) {
  if (!replyContext) return null
  return (
    <div className="flex items-start gap-2 rounded-t-2xl border-b border-(--border) bg-(--surface-subtle) px-3 py-2.5 text-xs text-(--muted)">
      <Reply size={14} className="mt-0.5 shrink-0 text-(--muted)" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-(--foreground)">Replying to prior response</p>
        <p className="mt-0.5 line-clamp-2 text-(--muted)">{replyContext.snippet}</p>
      </div>
      <Button variant="ghost" size="icon" type="button" onClick={() => setReplyContext(null)} className="h-auto w-auto shrink-0 rounded-md p-1 text-(--muted) transition-colors hover:bg-(--border) hover:text-(--foreground)" aria-label="Cancel reply">
        <X size={14} strokeWidth={1.75} />
      </Button>
    </div>
  )
}
