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
    <>
      <nav aria-label="File categories" className="space-y-0.5 px-2 pb-3">
        {CATEGORIES.map(({ id, label, Icon }) => {
          const active = category === id
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onChange(id)}
              className={`flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm transition-colors ${
                active
                  ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
              }`}
            >
              <Icon size={15} strokeWidth={1.75} className="shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          )
        })}
      </nav>
      <div aria-hidden="true" className="mx-2 border-t border-[var(--border)]" />
    </>
  )
}
