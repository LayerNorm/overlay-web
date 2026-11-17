import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Ellipsis, GripVertical, Pin, SlidersHorizontal } from 'lucide-react'
import { Button, DialogFrame, Popover, PopoverContent, PopoverTrigger, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@overlay/ui/primitives'
import { DelayedTooltip } from '@overlay/ui/overlays'
import type { PrimaryRailItem } from '../../../../../../packages/overlay-shell-react/src/types'

// Proposal 2: each person chooses which pages sit in the primary sidebar, in what order, and which stay under More.

type Layout = { rail: string[]; more: string[] }
type List = keyof Layout

const STORAGE_KEY = 'overlay.sidebar-layout'
const DEFAULT_MORE = ['files', 'extensions', 'automations']
const listeners = new Set<() => void>()
let saved: Layout | null = null
try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') } catch { saved = null }

function save(next: Layout | null) {
  saved = next
  try { if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); else localStorage.removeItem(STORAGE_KEY) } catch { /* Storage is blocked; the layout lasts for this visit. */ }
  listeners.forEach((listener) => listener())
}

function resolve(ids: string[]): Layout {
  const layout: Layout = { rail: (saved?.rail ?? []).filter((id) => ids.includes(id)), more: (saved?.more ?? []).filter((id) => ids.includes(id)) }
  // Pages added after the layout was saved land where they are by default.
  for (const id of ids) if (!layout.rail.includes(id) && !layout.more.includes(id)) layout[DEFAULT_MORE.includes(id) ? 'more' : 'rail'].push(id)
  return layout
}

export type SidebarLayout = ReturnType<typeof useSidebarLayout>

export function useSidebarLayout(items: readonly PrimaryRailItem[]) {
  useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => saved)
  const layout = resolve(items.map((item) => item.id))
  const byId = (id: string) => items.find((item) => item.id === id)!
  return {
    rail: layout.rail.map(byId),
    more: layout.more.map(byId),
    customized: saved !== null,
    /** Moves a page to a position in either list. The sidebar always keeps one page. */
    move(id: string, list: List, index: number) {
      if (list === 'more' && layout.rail.length === 1 && layout.rail[0] === id) return
      const next: Layout = { rail: layout.rail.filter((entry) => entry !== id), more: layout.more.filter((entry) => entry !== id) }
      next[list].splice(Math.max(0, Math.min(index, next[list].length)), 0, id)
      save(next)
    },
    reset: () => save(null),
  }
}

const CLOSE_DELAY_MS = 150

/** More, with a pin on each row and Customize at the end. Opens on hover like the production menu. */
export function CustomizableMoreMenu({ layout }: { layout: SidebarLayout }) {
  const [open, setOpen] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null }
  useEffect(() => cancelClose, [])
  const hoverOpen = (event: React.PointerEvent) => { if (event.pointerType === 'mouse') { cancelClose(); setOpen(true) } }
  const hoverClose = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }
  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton size="lg" isActive={layout.more.some((item) => item.active)} title="More" aria-label="More" className="justify-center px-0" onPointerEnter={hoverOpen} onPointerLeave={hoverClose}>
            <Ellipsis aria-hidden />
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" sideOffset={8} className="w-52 p-1" onPointerEnter={hoverOpen} onPointerLeave={hoverClose} onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
          <SidebarMenu>
            {layout.more.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton size="lg" isActive={item.active} className="[&>svg]:mx-1" onClick={() => { setOpen(false); item.onSelect() }}>
                  <item.icon aria-hidden />
                  <span>{item.label}</span>
                </SidebarMenuButton>
                <SidebarMenuAction showOnHover title="Pin to sidebar" aria-label={`Pin ${item.label} to sidebar`} className="right-1.5" onClick={() => layout.move(item.id, 'rail', layout.rail.length)}>
                  <Pin aria-hidden />
                </SidebarMenuAction>
              </SidebarMenuItem>
            ))}
            {layout.more.length === 0 ? <li className="px-3 py-2 text-xs text-(--muted-light)">Every page is pinned to the sidebar.</li> : null}
            <li role="separator" className="-mx-1 my-1 h-px bg-(--border)" />
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="text-(--muted) [&>svg]:mx-1" onClick={() => { setOpen(false); setCustomizing(true) }}>
                <SlidersHorizontal aria-hidden />
                <span>Customize sidebar</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </PopoverContent>
      </Popover>
      <CustomizeSidebarDialog layout={layout} open={customizing} onOpenChange={setCustomizing} />
    </SidebarMenuItem>
  )
}

function CustomizeSidebarDialog({ layout, open, onOpenChange }: { layout: SidebarLayout; open: boolean; onOpenChange(open: boolean): void }) {
  const [dragging, setDragging] = useState<string | null>(null)
  const section = (list: List, title: string, hint: string) => {
    const items = layout[list]
    const lastPinned = list === 'rail' && items.length === 1
    return (
      <section
        aria-label={title}
        onDragOver={(event) => {
          if (!dragging) return
          event.preventDefault()
          if (!items.some((item) => item.id === dragging)) layout.move(dragging, list, items.length)
        }}
      >
        <h3 className="mb-1 flex items-baseline justify-between px-1 text-xs font-medium text-(--muted)">
          {title}
          <span className="font-normal text-(--muted-light)">{hint}</span>
        </h3>
        <ul className="flex min-h-10 flex-col gap-0.5 rounded-xl bg-(--surface-subtle) p-1">
          {items.map((item, index) => (
            <li
              key={item.id}
              draggable
              onDragStart={(event) => { setDragging(item.id); event.dataTransfer.effectAllowed = 'move' }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => {
                if (!dragging || dragging === item.id) return
                event.preventDefault()
                event.stopPropagation()
                layout.move(dragging, list, index)
              }}
              className={`group/row flex h-9 cursor-grab items-center gap-2 rounded-lg pl-1 pr-1 text-sm transition-colors hover:bg-(--surface-elevated) active:cursor-grabbing ${dragging === item.id ? 'bg-(--surface-elevated) opacity-60' : ''}`}
            >
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Reorder ${item.label}. Use the arrow keys to move it.`}
                className="size-6 cursor-grab text-(--muted-light) hover:bg-transparent"
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  const next = index + (event.key === 'ArrowUp' ? -1 : 1)
                  if (next >= 0 && next < items.length) layout.move(item.id, list, next)
                  else if (list === 'rail' && next >= items.length) layout.move(item.id, 'more', 0)
                  else if (list === 'more' && next < 0) layout.move(item.id, 'rail', layout.rail.length)
                }}
              >
                <GripVertical size={14} aria-hidden />
              </Button>
              <item.icon size={16} aria-hidden className="shrink-0 text-(--muted)" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <DelayedTooltip label={list === 'rail' ? (lastPinned ? 'The sidebar keeps at least one page' : 'Unpin (move to More)') : 'Pin to sidebar'} side="left">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={lastPinned}
                  aria-pressed={list === 'rail'}
                  aria-label={list === 'rail' ? `Unpin ${item.label} from the sidebar` : `Pin ${item.label} to sidebar`}
                  className="size-7 text-(--muted-light) hover:text-(--foreground)"
                  onClick={() => layout.move(item.id, list === 'rail' ? 'more' : 'rail', list === 'rail' ? 0 : layout.rail.length)}
                >
                  <Pin size={14} aria-hidden className={list === 'rail' ? 'fill-current text-(--foreground)' : undefined} />
                </Button>
              </DelayedTooltip>
            </li>
          ))}
          {items.length === 0 ? <li className="flex h-9 items-center justify-center text-xs text-(--muted-light)">Drag a page here</li> : null}
        </ul>
      </section>
    )
  }
  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Customize sidebar"
      description="Drag pages to reorder them, or move them between the sidebar and More. Only you see this layout."
      className="max-w-[400px]"
      footer={(
        <>
          <Button variant="ghost" disabled={!layout.customized} onClick={layout.reset} className="mr-auto text-(--muted)">Reset to default</Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
        </>
      )}
    >
      <div className="mt-4 flex flex-col gap-4">
        {section('rail', 'Sidebar', 'Always visible')}
        {section('more', 'More', 'Shown on hover')}
      </div>
    </DialogFrame>
  )
}
