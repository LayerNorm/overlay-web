'use client'

import { FileText, ImageIcon } from 'lucide-react'

export function ChatDropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[color-mix(in_srgb,var(--background)_72%,transparent)] p-4 backdrop-blur-xs">
      <div className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-(--border) bg-[color-mix(in_srgb,var(--surface-elevated)_92%,transparent)] px-6 py-5 text-center shadow-[0_18px_55px_rgba(0,0,0,0.14)] ring-1 ring-black/3 dark:shadow-[0_18px_55px_rgba(0,0,0,0.36)] dark:ring-white/4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-(--border) bg-(--surface-subtle) text-(--muted)">
            <ImageIcon size={16} strokeWidth={1.75} />
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-(--border) bg-(--surface-subtle) text-(--muted)">
            <FileText size={16} strokeWidth={1.75} />
          </span>
        </div>
        <p className="text-sm font-medium text-(--foreground)">Drop images or documents here</p>
        <p className="mt-1 text-xs text-(--muted)">JPEG, PNG, PDF, Word, and text files</p>
      </div>
    </div>
  )
}
