/**
 * MentionPopup — caret-anchored @ mention popup.
 *
 * Direct port of the web app's MentionPopup (src/components/mentions/MentionPopup.tsx)
 * backed by desktop mention categories (notes, chats, documents, workspace files).
 * Must be rendered inside a `.shared-chat-scope` element so the CSS variables
 * (--border, --surface-elevated, ...) resolve.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Code, File, FileText, MessageSquare, Upload } from 'lucide-react'
import type { Mention, MentionType } from './MentionInput'

const ICON_MAP: Record<string, React.FC<{ size?: number; className?: string; strokeWidth?: number }>> = {
  FileText,
  MessageSquare,
  File,
  Code
}

export const MENTION_CATEGORY_ORDER: Array<{ type: MentionType; label: string; icon: string }> = [
  { type: 'file', label: 'Files', icon: 'Code' },
  { type: 'note', label: 'Notes', icon: 'FileText' },
  { type: 'chat', label: 'Chats', icon: 'MessageSquare' },
  { type: 'document', label: 'Documents', icon: 'File' }
]

export interface MentionCategoryResult {
  type: MentionType
  items: Mention[]
}

function CategoryIcon({ icon, className }: { icon: string; className?: string }): React.ReactElement | null {
  const Icon = ICON_MAP[icon]
  if (!Icon) return null
  return <Icon size={14} strokeWidth={1.75} className={className} />
}

interface MentionPopupProps {
  categories: MentionCategoryResult[]
  loading: boolean
  position: { x: number; y: number } | null
  onSelect: (item: Mention) => void
  onUploadFile: () => void
  onClose: () => void
  query: string
  /** Active category filter. null = top-level category picker. */
  selectedCategory: MentionType | null
  onSelectedCategoryChange: (category: MentionType | null) => void
  /** Categories offered in the top-level picker (e.g. files only with a working folder). */
  availableTypes: MentionType[]
}

type Row =
  | { kind: 'category'; type: MentionType; label: string; icon: string }
  | { kind: 'item'; item: Mention; categoryType: MentionType }
  | { kind: 'upload' }

export function MentionPopup({
  categories,
  loading,
  position,
  onSelect,
  onUploadFile,
  onClose,
  query,
  selectedCategory,
  onSelectedCategoryChange,
  availableTypes
}: MentionPopupProps): React.ReactElement | null {
  const [activeIndex, setActiveIndex] = useState(0)
  const popupRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const rows: Row[] = useMemo(() => {
    const list: Row[] = []

    // Top-level with empty query: show category buttons only
    if (selectedCategory === null && query.trim() === '') {
      for (const cat of MENTION_CATEGORY_ORDER) {
        if (!availableTypes.includes(cat.type)) continue
        list.push({ kind: 'category', type: cat.type, label: cat.label, icon: cat.icon })
      }
      list.push({ kind: 'upload' })
      return list
    }

    // Top-level with query: show all matching entities (no category headers)
    if (selectedCategory === null) {
      for (const cat of categories) {
        for (const item of cat.items) {
          list.push({ kind: 'item', item, categoryType: cat.type })
        }
      }
      list.push({ kind: 'upload' })
      return list
    }

    // Category-specific view: only items of that category (filtered via query)
    const cat = categories.find((c) => c.type === selectedCategory)
    if (cat) {
      for (const item of cat.items) {
        list.push({ kind: 'item', item, categoryType: cat.type })
      }
    }
    if (selectedCategory === 'document' || selectedCategory === 'file') {
      list.push({ kind: 'upload' })
    }
    return list
  }, [categories, query, selectedCategory, availableTypes])

  // Reset active row when query/category changes
  useEffect(() => {
    queueMicrotask(() => setActiveIndex(0))
  }, [query, selectedCategory, rows.length])

  useEffect(() => {
    const el = itemRefs.current[activeIndex]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
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
    function handleClick(e: MouseEvent): void {
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
    Math.max(viewportPadding, window.innerWidth - popupWidth - viewportPadding)
  )
  const top = position.y + 18
  const shouldOpenUp = window.innerHeight - top < popupHeight && position.y > popupHeight

  const selectedCategoryMeta = selectedCategory
    ? MENTION_CATEGORY_ORDER.find((c) => c.type === selectedCategory)
    : null

  const isEmptyResults = rows.length === 0 || (rows.length === 1 && rows[0]!.kind === 'upload')

  const uploadRow = (idx: number, withBorder: boolean): React.ReactElement => (
    <div key="upload" className={withBorder ? 'border-t border-[var(--border)]' : undefined}>
      <button
        ref={(el) => {
          itemRefs.current[idx] = el
        }}
        type="button"
        onClick={onUploadFile}
        onMouseEnter={() => setActiveIndex(idx)}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
          idx === activeIndex
            ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
            : 'text-[var(--muted)] hover:bg-[var(--surface-muted)]'
        }`}
      >
        <Upload size={12} strokeWidth={1.75} className="shrink-0 opacity-70" />
        <span className="font-medium">Upload a file...</span>
      </button>
    </div>
  )

  return (
    <div
      ref={popupRef}
      className="overlay-pop-in fixed z-50 flex max-h-80 w-72 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-xl"
      style={{
        left: `${left}px`,
        ...(shouldOpenUp
          ? { bottom: `${Math.max(viewportPadding, window.innerHeight - position.y + 8)}px` }
          : { top: `${top}px` })
      }}
    >
      {selectedCategoryMeta && (
        <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-light)]">
          <button
            type="button"
            onClick={() => onSelectedCategoryChange(null)}
            className="transition-colors hover:text-[var(--foreground)]"
          >
            All
          </button>
          <ChevronRight size={10} className="opacity-60" />
          <CategoryIcon icon={selectedCategoryMeta.icon} className="opacity-60" />
          <span>{selectedCategoryMeta.label}</span>
          <span className="ml-auto text-[9px] opacity-60">esc to go back</span>
        </div>
      )}

      <div className="overflow-y-auto">
        {loading && categories.length === 0 && selectedCategory !== null ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--muted)] border-t-transparent" />
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
            {rows.map((row, idx) => (row.kind === 'upload' ? uploadRow(idx, true) : null))}
          </>
        ) : (
          rows.map((row, idx) => {
            const isActive = idx === activeIndex
            if (row.kind === 'category') {
              return (
                <button
                  key={`cat-${row.type}`}
                  ref={(el) => {
                    itemRefs.current[idx] = el
                  }}
                  type="button"
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
              return uploadRow(idx, true)
            }
            const { item, categoryType } = row
            const fallbackIcon = MENTION_CATEGORY_ORDER.find((c) => c.type === categoryType)?.icon || 'FileText'
            return (
              <button
                key={`${categoryType}-${item.id}`}
                ref={(el) => {
                  itemRefs.current[idx] = el
                }}
                type="button"
                onClick={() => onSelect(item)}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors ${
                  isActive
                    ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-muted)]'
                }`}
              >
                <CategoryIcon icon={fallbackIcon} className="shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                {item.preview && (
                  <span className="max-w-[100px] shrink-0 truncate text-[10px] text-[var(--muted-light)]">
                    {item.preview}
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
