'use client'

import { BookOpen, FileText, Files, Images } from 'lucide-react'
import type { InlineNavItem } from './AppSidebarInlinePanels'

export type FilesCategory = 'all' | 'notes' | 'files' | 'outputs'

/** Subnavigation for the Files secondary panel, mirroring `chatsInlineItems`. */
export const filesInlineItems: ReadonlyArray<InlineNavItem> = [
  { id: 'all', label: 'All', icon: Files },
  { id: 'notes', label: 'Notes', icon: BookOpen },
  { id: 'files', label: 'Files', icon: FileText },
  { id: 'outputs', label: 'Outputs', icon: Images },
]

export function resolveFilesCategory(view: string | null | undefined): FilesCategory {
  if (view === 'notes' || view === 'files' || view === 'outputs') return view
  return 'all'
}
