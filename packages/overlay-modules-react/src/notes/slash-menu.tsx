import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

export interface SlashMenuItem {
  title: string
  description: string
  icon: React.ReactNode
  command: () => void
  category: 'nodes' | 'media' | 'marks' | 'table'
  /** The Markdown a writer can type instead, shown at the row's end. */
  shortcut?: string
}

interface SlashMenuProps {
  showSlashMenu: boolean
  slashMenuPosition: { top: number; left: number }
  slashMenuFilter: string
  selectedSlashIndex: number
  setSelectedSlashIndex: (index: number) => void
  filteredSlashItems: SlashMenuItem[]
  executeSlashCommand: (item: SlashMenuItem) => void
  onClose: () => void
}

const SECTION_ORDER: Array<{ category: SlashMenuItem['category']; label: string }> = [
  { category: 'nodes', label: 'Basic blocks' },
  { category: 'table', label: 'Table' },
  { category: 'media', label: 'Media' },
  { category: 'marks', label: 'Formatting' },
]

const MENU_WIDTH = 300
const MENU_MAX_HEIGHT = 340

const subscribeToViewportResize = (onStoreChange: () => void) => {
  window.addEventListener('resize', onStoreChange)
  return () => window.removeEventListener('resize', onStoreChange)
}
const getViewportWidth = () => window.innerWidth
const getViewportHeight = () => window.innerHeight
const getServerViewportSize = () => Number.POSITIVE_INFINITY

/** The block menu opened by typing `/` or the block handle's +: a filterable command list in the app's menu style. */
export function SlashMenu({
  showSlashMenu,
  slashMenuPosition,
  slashMenuFilter,
  selectedSlashIndex,
  setSelectedSlashIndex,
  filteredSlashItems,
  executeSlashCommand,
  onClose,
}: SlashMenuProps): React.ReactElement | null {
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const viewportWidth = useSyncExternalStore(subscribeToViewportResize, getViewportWidth, getServerViewportSize)
  const viewportHeight = useSyncExternalStore(subscribeToViewportResize, getViewportHeight, getServerViewportSize)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time portal host
    setPortalHost(document.body)
  }, [])

  useEffect(() => {
    if (!showSlashMenu) return
    const handleClickOutside = (event: MouseEvent): void => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSlashMenu, onClose])

  useEffect(() => {
    if (!showSlashMenu) return
    slashMenuRef.current
      ?.querySelector<HTMLElement>(`[data-slash-index="${selectedSlashIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedSlashIndex, showSlashMenu])

  if (!showSlashMenu || !portalHost) return null

  const menu = (
    <div
      ref={slashMenuRef}
      role="listbox"
      aria-label="Insert block"
      data-slot="note-slash-menu"
      className="overlay-pop-in fixed z-100000 overflow-y-auto overscroll-contain rounded-[10px] border border-(--border) bg-(--surface-elevated) p-1 text-[13px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(0,0,0,0.12)]"
      style={{
        top: Math.max(8, Math.min(slashMenuPosition.top, viewportHeight - MENU_MAX_HEIGHT - 8)),
        left: Math.max(8, Math.min(slashMenuPosition.left, viewportWidth - MENU_WIDTH - 8)),
        width: MENU_WIDTH,
        maxHeight: MENU_MAX_HEIGHT,
      }}
      // Keep the editor's selection (and the typed "/query") while the pointer is in the menu.
      onMouseDown={(event) => event.preventDefault()}
    >
      {slashMenuFilter ? (
        <div className="-mx-1 mb-1 flex items-center gap-1.5 border-b border-(--border) px-3 pb-2 pt-1.5 text-[12.5px] text-(--muted)">
          Filter: <span className="font-medium text-(--foreground)">{slashMenuFilter}</span>
        </div>
      ) : null}
      {filteredSlashItems.length === 0 ? (
        <div className="px-2 py-2.5 text-(--muted)">No matching blocks</div>
      ) : (
        SECTION_ORDER.map(({ category, label }) => {
          const sectionItems = filteredSlashItems.filter((item) => item.category === category)
          if (sectionItems.length === 0) return null
          return (
            <div key={category} role="group" aria-label={label}>
              <div className="px-2 pb-1 pt-1.5 text-[11.5px] font-medium text-(--muted)">{label}</div>
              {sectionItems.map((item) => {
                const globalIndex = filteredSlashItems.indexOf(item)
                const active = selectedSlashIndex === globalIndex
                return (
                  <Button
                    variant="ghost"
                    type="button"
                    key={item.title}
                    role="option"
                    aria-selected={active}
                    data-slash-index={globalIndex}
                    onClick={() => executeSlashCommand(item)}
                    onMouseMove={() => { if (!active) setSelectedSlashIndex(globalIndex) }}
                    className={unstyledButton(`flex h-auto w-full items-center gap-2.5 rounded-md py-1 pl-1 pr-2 text-left font-normal ${
                      active ? 'bg-(--surface-subtle)' : 'bg-transparent'
                    }`)}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-md border border-(--border) bg-(--surface-elevated) text-(--foreground)">
                      {item.icon}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-medium leading-[18px] text-(--foreground)">{item.title}</span>
                      <span className="truncate text-[11.5px] leading-4 text-(--muted)">{item.description}</span>
                    </span>
                    {item.shortcut ? (
                      <kbd className="shrink-0 font-mono text-[11px] text-(--muted-light)">{item.shortcut}</kbd>
                    ) : null}
                  </Button>
                )
              })}
            </div>
          )
        })
      )}
    </div>
  )

  return createPortal(menu, portalHost)
}
