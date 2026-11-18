'use client'

import { useState } from 'react'
import { GripVertical, Pin } from 'lucide-react'
import { Button, DialogFrame } from '@overlay/ui/primitives'
import { DelayedTooltip } from '@overlay/ui/overlays'
import type { PrimaryRailItem } from '../types'

export type SidebarPageList = 'pinned' | 'more'

/** A person's own arrangement of the primary sidebar; the host resolves and saves it. */
export interface SidebarCustomization {
  /** Page ids in the primary sidebar, in order. The first is the page the app opens to. */
  pinned: readonly string[]
  /** Page ids under More, in order. */
  more: readonly string[]
  /** Whether the layout differs from the default, which enables Reset. */
  customized: boolean
  onMove: (id: string, list: SidebarPageList, index: number) => void
  onReset: () => void
}

export function orderSidebarItems(items: readonly PrimaryRailItem[], ids: readonly string[]): PrimaryRailItem[] {
  return ids.flatMap((id) => {
    const item = items.find((entry) => entry.id === id)
    return item ? [item] : []
  })
}

export function CustomizeSidebarDialog({
  items,
  customization,
  open,
  onOpenChange,
}: {
  items: readonly PrimaryRailItem[]
  customization: SidebarCustomization
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const lists: Record<SidebarPageList, PrimaryRailItem[]> = {
    pinned: orderSidebarItems(items, customization.pinned),
    more: orderSidebarItems(items, customization.more),
  }
  const section = (list: SidebarPageList, title: string, hint: string) => {
    const rows = lists[list]
    const lastPinned = list === 'pinned' && rows.length === 1
    return (
      <section
        aria-label={title}
        onDragOver={(event) => {
          if (!dragging) return
          event.preventDefault()
          if (!rows.some((item) => item.id === dragging)) customization.onMove(dragging, list, rows.length)
        }}
      >
        <h3 className="mb-1 flex items-baseline justify-between px-1 text-xs font-medium text-(--muted)">
          {title}
          <span className="font-normal text-(--muted-light)">{hint}</span>
        </h3>
        <ul className="flex min-h-10 flex-col gap-0.5 rounded-xl bg-(--surface-subtle) p-1">
          {rows.map((item, index) => (
            <li
              key={item.id}
              draggable
              onDragStart={(event) => { setDragging(item.id); event.dataTransfer.effectAllowed = 'move' }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => {
                if (!dragging || dragging === item.id) return
                event.preventDefault()
                event.stopPropagation()
                customization.onMove(dragging, list, index)
              }}
              className={`flex h-9 cursor-grab items-center gap-2 rounded-lg px-1 text-sm transition-colors hover:bg-(--surface-elevated) active:cursor-grabbing ${dragging === item.id ? 'bg-(--surface-elevated) opacity-60' : ''}`}
            >
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label={`Reorder ${item.label}. Use the arrow keys to move it.`}
                className="size-6 cursor-grab text-(--muted-light) hover:bg-transparent"
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  const next = index + (event.key === 'ArrowUp' ? -1 : 1)
                  if (next >= 0 && next < rows.length) customization.onMove(item.id, list, next)
                  else if (list === 'pinned' && next >= rows.length) customization.onMove(item.id, 'more', 0)
                  else if (list === 'more' && next < 0) customization.onMove(item.id, 'pinned', lists.pinned.length)
                }}
              >
                <GripVertical size={14} aria-hidden />
              </Button>
              <item.icon size={16} aria-hidden className="shrink-0 text-(--muted)" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {list === 'pinned' && index === 0 ? <span className="text-[11px] text-(--muted-light)">Opens first</span> : null}
              <DelayedTooltip label={list === 'pinned' ? (lastPinned ? 'The sidebar keeps at least one page' : 'Unpin (move to More)') : 'Pin to sidebar'} side="left">
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  disabled={lastPinned}
                  aria-pressed={list === 'pinned'}
                  aria-label={list === 'pinned' ? `Unpin ${item.label} from the sidebar` : `Pin ${item.label} to sidebar`}
                  className="size-7 text-(--muted-light) hover:text-(--foreground)"
                  onClick={() => customization.onMove(item.id, list === 'pinned' ? 'more' : 'pinned', list === 'pinned' ? 0 : lists.pinned.length)}
                >
                  <Pin size={14} aria-hidden className={list === 'pinned' ? 'fill-current text-(--foreground)' : undefined} />
                </Button>
              </DelayedTooltip>
            </li>
          ))}
          {rows.length === 0 ? <li className="flex h-9 items-center justify-center text-xs text-(--muted-light)">Drag a page here</li> : null}
        </ul>
      </section>
    )
  }
  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Customize sidebar"
      description="Drag pages to reorder them, or move them between the sidebar and More. The app opens to the first page in the sidebar. Only you see this layout."
      className="max-w-[400px]"
      footer={(
        <>
          <Button variant="ghost" type="button" disabled={!customization.customized} onClick={customization.onReset} className="mr-auto text-(--muted)">Reset to default</Button>
          <Button variant="primary" type="button" onClick={() => onOpenChange(false)}>Done</Button>
        </>
      )}
    >
      <div className="mt-4 flex flex-col gap-4">
        {section('pinned', 'Sidebar', 'Always visible')}
        {section('more', 'More', 'Shown on hover')}
      </div>
    </DialogFrame>
  )
}
