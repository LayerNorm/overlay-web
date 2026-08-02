'use client'

import { BookOpen, FileText, Files, Images } from 'lucide-react'

export type FilesCategory = 'all' | 'notes' | 'files' | 'outputs'

const CATEGORIES = [
  { id: 'all' as const, label: 'All', Icon: Files },
  { id: 'notes' as const, label: 'Notes', Icon: BookOpen },
  { id: 'files' as const, label: 'Files', Icon: FileText },
  { id: 'outputs' as const, label: 'Outputs', Icon: Images },
]

export function resolveFilesCategory(view: string | null | undefined): FilesCategory {
  if (view === 'notes' || view === 'files' || view === 'outputs') return view
  return 'all'
}

export function FilesCategorySidebar({
  category,
  onChange,
}: {
  category: FilesCategory
  onChange: (category: FilesCategory) => void
}) {
  return (
    <nav aria-label="File categories" className="flex flex-col gap-1 px-2 pb-2">
      {CATEGORIES.map(({ id, label, Icon }) => {
        const active = category === id
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onChange(id)}
            className={`flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs transition-colors ${
              active
                ? 'bg-[var(--surface-subtle)] font-medium text-[var(--foreground)]'
                : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
            }`}
          >
            <Icon size={14} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
