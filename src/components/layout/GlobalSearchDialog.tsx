'use client'

/**
 * Global search (Cmd+K) container. Search + navigation wiring stays here;
 * presentation lives in @overlay/ui CommandPalette.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { CommandPalette, type CommandPaletteRow } from '@overlay/ui/overlays'
import {
  BookOpen,
  FileText,
  MessageSquare,
  Plug,
  Server,
  Sparkles,
  Zap,
} from 'lucide-react'
import { invalidateMentionCache, searchMentions } from '@/components/mentions/mention-search'
import type { MentionCategory, MentionItem, MentionType } from '@/shared/knowledge/mention-types'

const ICON_MAP: Record<string, React.FC<{ size?: number; className?: string; strokeWidth?: number }>> = {
  BookOpen,
  FileText,
  Plug,
  Zap,
  Sparkles,
  Server,
  MessageSquare,
}

const CATEGORY_ORDER: Array<{ type: MentionType; label: string; icon: string }> = [
  { type: 'chat', label: 'Chats', icon: 'MessageSquare' },
  { type: 'file', label: 'Files', icon: 'FileText' },
  { type: 'knowledge', label: 'Knowledge', icon: 'BookOpen' },
  { type: 'automation', label: 'Automations', icon: 'Zap' },
  { type: 'skill', label: 'Skills', icon: 'Sparkles' },
  { type: 'mcp', label: 'MCP Servers', icon: 'Server' },
  { type: 'connector', label: 'Connectors', icon: 'Plug' },
]

function CategoryIcon({ icon, className, size = 16 }: { icon: string; className?: string; size?: number }) {
  const Icon = ICON_MAP[icon]
  if (!Icon) return null
  return <Icon size={size} strokeWidth={1.75} className={className} />
}

function hrefForItem(item: MentionItem): string {
  switch (item.type) {
    case 'chat':
      return `/app/chat?id=${encodeURIComponent(item.id)}`
    case 'file':
      if (item.description === 'note') return `/app/notes?id=${encodeURIComponent(item.id)}`
      return `/app/files?file=${encodeURIComponent(item.id)}`
    case 'knowledge':
      return `/app/knowledge/${encodeURIComponent(item.id)}`
    case 'automation':
      return `/app/automations?automationId=${encodeURIComponent(item.id)}`
    case 'skill':
      return `/app/tools?view=skills&id=${encodeURIComponent(item.id)}`
    case 'mcp':
      return `/app/tools?view=mcps&id=${encodeURIComponent(item.id)}`
    case 'connector':
      return `/app/tools?view=apps&slug=${encodeURIComponent(item.id)}`
    default:
      return '/app'
  }
}

interface GlobalSearchDialogProps {
  open: boolean
  onClose: () => void
  initialCategory?: MentionType | null
  onNewChat: () => void
}

type RowSource =
  | { kind: 'category'; type: MentionType; label: string; icon: string }
  | { kind: 'item'; item: MentionItem; categoryType: MentionType }

export function GlobalSearchDialog({ open, onClose, initialCategory = null, onNewChat }: GlobalSearchDialogProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<MentionType | null>(initialCategory)
  const [categories, setCategories] = useState<MentionCategory[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    invalidateMentionCache()
    queueMicrotask(() => {
      setQuery('')
      setSelectedCategory(initialCategory)
    })
  }, [open, initialCategory])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
    })
    void searchMentions(query)
      .then((cats) => {
        if (cancelled) return
        setCategories(cats)
      })
      .catch(() => {
        if (cancelled) return
        setCategories([])
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, query])

  const rowSources: RowSource[] = useMemo(() => {
    const list: RowSource[] = []
    const trimmed = query.trim()

    if (selectedCategory === null) {
      if (trimmed === '') {
        const availableTypes = new Set(categories.map((cat) => cat.type))
        for (const cat of CATEGORY_ORDER.filter((item) => availableTypes.has(item.type))) {
          list.push({ kind: 'category', type: cat.type, label: cat.label, icon: cat.icon })
        }
        return list
      }
      for (const cat of categories) {
        for (const item of cat.items) {
          list.push({ kind: 'item', item, categoryType: cat.type })
        }
      }
      return list
    }

    const cat = categories.find((c) => c.type === selectedCategory)
    if (cat) {
      for (const item of cat.items) {
        list.push({ kind: 'item', item, categoryType: cat.type })
      }
    }
    return list
  }, [categories, query, selectedCategory])

  const rows: CommandPaletteRow[] = useMemo(() => {
    return rowSources.map((row) => {
      if (row.kind === 'category') {
        return {
          kind: 'category' as const,
          id: `cat-${row.type}`,
          label: row.label,
          icon: <CategoryIcon icon={row.icon} className="shrink-0 opacity-70" />,
        }
      }
      const fallbackIcon = CATEGORY_ORDER.find((c) => c.type === row.categoryType)?.icon || 'FileText'
      return {
        kind: 'item' as const,
        id: `${row.categoryType}-${row.item.id}`,
        label: row.item.name,
        description: row.item.description,
        logoUrl: row.item.logoUrl,
        icon: row.item.logoUrl ? undefined : (
          <CategoryIcon icon={row.item.icon || fallbackIcon} className="shrink-0 opacity-70" />
        ),
      }
    })
  }, [rowSources])

  const selectedCategoryMeta = selectedCategory
    ? CATEGORY_ORDER.find((c) => c.type === selectedCategory)
    : null

  const placeholder = selectedCategoryMeta
    ? `Search ${selectedCategoryMeta.label.toLowerCase()}...`
    : 'Type a command or search...'

  const emptyState: ReactNode | undefined =
    !loading && rows.length === 0
      ? query.trim() !== ''
        ? <>No results for &ldquo;{query}&rdquo;</>
        : <>Nothing here yet</>
      : undefined

  const handleActivateRow = useCallback(
    (row: CommandPaletteRow) => {
      if (row.kind === 'action') {
        if (row.id === 'new-chat') {
          onNewChat()
          onClose()
        }
        return
      }
      if (row.kind === 'category') {
        const type = row.id.replace(/^cat-/, '') as MentionType
        setSelectedCategory(type)
        return
      }
      const source = rowSources.find(
        (candidate) => candidate.kind === 'item' && `${candidate.categoryType}-${candidate.item.id}` === row.id,
      )
      if (source?.kind === 'item') {
        router.push(hrefForItem(source.item))
        onClose()
      }
    },
    [onClose, onNewChat, router, rowSources],
  )

  const handleBreadcrumbBack = useCallback(() => {
    setSelectedCategory(null)
    setQuery('')
  }, [])

  return (
    <CommandPalette
      open={open}
      onClose={onClose}
      query={query}
      onQueryChange={setQuery}
      placeholder={placeholder}
      breadcrumb={
        selectedCategoryMeta
          ? {
              label: selectedCategoryMeta.label,
              icon: <CategoryIcon icon={selectedCategoryMeta.icon} size={11} />,
            }
          : null
      }
      onBreadcrumbBack={handleBreadcrumbBack}
      rows={rows}
      loading={loading}
      emptyState={emptyState}
      onActivateRow={handleActivateRow}
    />
  )
}
