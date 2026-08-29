'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  FileText,
  MessageSquare,
  Plug,
  Server,
  Sparkles,
  Upload,
  UsersRound,
  Zap,
} from 'lucide-react'
import type { MentionCategory, MentionItem, MentionType } from '@/shared/knowledge/mention-types'

const ICON_MAP: Record<string, React.FC<{ size?: number; className?: string; strokeWidth?: number }>> = {
  FileText,
  BookOpen,
  Plug,
  Zap,
  Sparkles,
  Server,
  MessageSquare,
  UsersRound,
}

const CATEGORY_ORDER: Array<{ type: MentionType; label: string; icon: string }> = [
  { type: 'person', label: 'Members', icon: 'UsersRound' },
  { type: 'file', label: 'Files', icon: 'FileText' },
  { type: 'knowledge', label: 'Knowledge Bases', icon: 'BookOpen' },
  { type: 'connector', label: 'Connectors', icon: 'Plug' },
  { type: 'automation', label: 'Automations', icon: 'Zap' },
  { type: 'skill', label: 'Skills', icon: 'Sparkles' },
  { type: 'mcp', label: 'MCP Servers', icon: 'Server' },
  { type: 'chat', label: 'Chats', icon: 'MessageSquare' },
]

function CategoryIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = ICON_MAP[icon]
  if (!Icon) return null
  return <Icon size={14} strokeWidth={1.75} className={className} />
}

interface MentionPopupProps {
  categories: MentionCategory[]
  loading: boolean
  position: { x: number; y: number } | null
  onSelect: (item: MentionItem) => void
  onUploadFile: () => void
  onClose: () => void
  query: string
  availableTypes?: readonly MentionType[]
  /** Active category filter. null = top-level category picker. */
  selectedCategory: MentionType | null
  onSelectedCategoryChange: (category: MentionType | null) => void
  /** Reports the active option id so the combobox can set aria-activedescendant. */
  onActiveOptionChange?: (optionId: string | null) => void
}

type Row =
  | { kind: 'category'; type: MentionType; label: string; icon: string }
  | { kind: 'item'; item: MentionItem; categoryType: MentionType }
  | { kind: 'upload' }

export function MentionPopup({
  categories,
  loading,
  position,
  onSelect,
  onUploadFile,
  onClose,
  query,
  availableTypes,
  selectedCategory,
  onSelectedCategoryChange,
  onActiveOptionChange,
}: MentionPopupProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const popupRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const rows: Row[] = useMemo(() => {
    const list: Row[] = []
    const allowedTypes = new Set(availableTypes ?? CATEGORY_ORDER.map((cat) => cat.type))
    const categoryOrder = CATEGORY_ORDER.filter((cat) => allowedTypes.has(cat.type))

    // Top-level with empty query: show category buttons only
    if (selectedCategory === null && query.trim() === '') {
      for (const cat of categoryOrder) {
        list.push({ kind: 'category', type: cat.type, label: cat.label, icon: cat.icon })
      }
      if (allowedTypes.has('file')) list.push({ kind: 'upload' })
      return list
    }

    // Top-level with query: show all matching entities (no category headers)
    if (selectedCategory === null) {
      for (const cat of categories) {
        if (!allowedTypes.has(cat.type)) continue
        for (const item of cat.items) {
          list.push({ kind: 'item', item, categoryType: cat.type })
        }
      }
      // Always allow upload even during search
      if (allowedTypes.has('file')) list.push({ kind: 'upload' })
      return list
    }

    // Category-specific view: only items of that category (filtered via query)
    const cat = allowedTypes.has(selectedCategory)
      ? categories.find((c) => c.type === selectedCategory)
      : null
    if (cat) {
      for (const item of cat.items) {
        list.push({ kind: 'item', item, categoryType: cat.type })
      }
    }
    if (selectedCategory === 'file' && allowedTypes.has('file')) {
      list.push({ kind: 'upload' })
    }
    return list
  }, [availableTypes, categories, query, selectedCategory])

  // Reset active row when query/category changes
  useEffect(() => {
    queueMicrotask(() => setActiveIndex(0))
  }, [query, selectedCategory, rows.length])

  useEffect(() => {
    const el = itemRefs.current[activeIndex]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  useEffect(() => {
    onActiveOptionChange?.(rows[activeIndex] ? `mention-option-${activeIndex}` : null)
  }, [activeIndex, rows, onActiveOptionChange])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setActiveIndex((prev) => Math.min(prev + 1, rows.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActiveIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        const current = rows[activeIndex]
        if (!current) return
        if (current.kind === 'category') {
          onSelectedCategoryChange(current.type)
        } else if (current.kind === 'upload') {
          onUploadFile()
        } else {
          onSelect(current.item)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (selectedCategory !== null) {
          // Go back to top-level category picker
          onSelectedCategoryChange(null)
        } else {
          onClose()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [activeIndex, rows, onSelect, onUploadFile, onClose, onSelectedCategoryChange, selectedCategory])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  if (!position) return null

  const popupWidth = 288
  const popupHeight = 320
  const viewportPadding = 8
  const left = Math.min(
    Math.max(viewportPadding, position.x),
    Math.max(viewportPadding, window.innerWidth - popupWidth - viewportPadding),
  )
  const top = position.y + 18
  const shouldOpenUp = window.innerHeight - top < popupHeight && position.y > popupHeight

  const selectedCategoryMeta = selectedCategory
    ? CATEGORY_ORDER.find((c) => c.type === selectedCategory)
    : null

  const isEmptyResults = rows.length === 0 || (rows.length === 1 && rows[0]!.kind === 'upload')

  return (
    <div
      ref={popupRef}
      className="overlay-pop-in fixed z-50 w-72 max-h-80 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-xl flex flex-col"
      style={{
        left: `${left}px`,
        ...(shouldOpenUp
          ? { bottom: `${Math.max(viewportPadding, window.innerHeight - position.y + 8)}px` }
          : { top: `${top}px` }),
      }}
    >
      {/* Breadcrumb header when in category view */}
      {selectedCategoryMeta && (
        <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-light)]">
          <button
            type="button"
            onClick={() => onSelectedCategoryChange(null)}
            className="hover:text-[var(--foreground)] transition-colors"
          >
            All
          </button>
          <ChevronRight size={10} className="opacity-60" />
          <CategoryIcon icon={selectedCategoryMeta.icon} className="opacity-60" />
          <span>{selectedCategoryMeta.label}</span>
          <span className="ml-auto text-[9px] opacity-60">esc to go back</span>
        </div>
      )}

      <div className="overflow-y-auto" role="listbox" id="mention-listbox" aria-label="Mention suggestions">
        {loading && isEmptyResults ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--muted-light)]" role="status" aria-live="polite">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--muted)] border-t-transparent" />
            <span>Loading mentions...</span>
          </div>
        ) : isEmptyResults && (query.trim() !== '' || selectedCategory !== null) ? (
          <>
            <div className="px-3 py-4 text-center text-xs text-[var(--muted-light)]">
              {query.trim() !== '' ? (
                <>No results for &ldquo;{query}&rdquo;</>
              ) : selectedCategoryMeta ? (
                <>No {selectedCategoryMeta.label.toLowerCase()} yet</>
              ) : (
                <>No results</>
              )}
            </div>
            {rows.map((row, idx) => {
              if (row.kind !== 'upload') return null
              const isActive = idx === activeIndex
              return (
                <div key="upload" className="border-t border-[var(--border)]">
                  <button
                    ref={(el) => { itemRefs.current[idx] = el }}
                    type="button"
                    role="option"
                    id={`mention-option-${idx}`}
                    aria-selected={isActive}
                    onClick={onUploadFile}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                      isActive
                        ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                        : 'text-[var(--muted)] hover:bg-[var(--surface-muted)]'
                    }`}
                  >
                    <Upload size={12} strokeWidth={1.75} className="shrink-0 opacity-70" />
                    <span className="font-medium">Upload a file...</span>
                  </button>
                </div>
              )
            })}
          </>
        ) : (
          rows.map((row, idx) => {
            const isActive = idx === activeIndex
            if (row.kind === 'category') {
              return (
                <button
                  key={`cat-${row.type}`}
                  ref={(el) => { itemRefs.current[idx] = el }}
                  type="button"
                  role="option"
                  id={`mention-option-${idx}`}
                  aria-selected={isActive}
                  onClick={() => onSelectedCategoryChange(row.type)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                    isActive
                      ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                      : 'text-[var(--muted)] hover:bg-[var(--surface-muted)]'
                  }`}
                >
                  <CategoryIcon icon={row.icon} className="shrink-0 opacity-70" />
                  <span className="flex-1 font-medium">{row.label}</span>
                  <ChevronRight size={12} strokeWidth={1.75} className="shrink-0 opacity-50" />
                </button>
              )
            }
            if (row.kind === 'upload') {
              return (
                <div key="upload" className="border-t border-[var(--border)]">
                  <button
                    ref={(el) => { itemRefs.current[idx] = el }}
                    type="button"
                    role="option"
                    id={`mention-option-${idx}`}
                    aria-selected={isActive}
                    onClick={onUploadFile}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                      isActive
                        ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                        : 'text-[var(--muted)] hover:bg-[var(--surface-muted)]'
                    }`}
                  >
                    <Upload size={12} strokeWidth={1.75} className="shrink-0 opacity-70" />
                    <span className="font-medium">Upload a file...</span>
                  </button>
                </div>
              )
            }
            // item
            const { item, categoryType } = row
            const fallbackIcon = CATEGORY_ORDER.find((c) => c.type === categoryType)?.icon || 'FileText'
            return (
              <button
                key={`${categoryType}-${item.id}`}
                ref={(el) => { itemRefs.current[idx] = el }}
                type="button"
                role="option"
                id={`mention-option-${idx}`}
                aria-selected={isActive}
                onClick={() => onSelect(item)}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors ${
                  isActive
                    ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-muted)]'
                }`}
              >
                {item.logoUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={item.logoUrl} alt="" className="h-4 w-4 shrink-0 rounded object-contain" />
                ) : (
                  <CategoryIcon icon={item.icon || fallbackIcon} className="shrink-0 opacity-70" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                {item.description && (
                  <span className="shrink-0 truncate text-[10px] text-[var(--muted-light)] max-w-[100px]">
                    {item.description}
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
