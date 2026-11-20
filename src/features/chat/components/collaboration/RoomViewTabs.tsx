'use client'

import { GitBranch, Pin, UsersRound, X, type LucideIcon } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import type { RoomPanelKind } from './RoomSidePanels'

export type RoomViewKind = Extract<RoomPanelKind, 'assignments' | 'people' | 'pinned'>

export const ROOM_VIEWS: readonly RoomViewKind[] = ['assignments', 'people', 'pinned']

const VIEW_META: Record<RoomViewKind, { label: string; icon: LucideIcon }> = {
  assignments: { label: 'Assignments', icon: GitBranch },
  people: { label: 'People', icon: UsersRound },
  pinned: { label: 'Pinned', icon: Pin },
}

export function isRoomView(panel: RoomPanelKind | null): panel is RoomViewKind {
  return panel !== null && (ROOM_VIEWS as readonly string[]).includes(panel)
}

/** The header of a room's sidebar: one tab per view, each with its count, and a close button. */
export function RoomViewTabs({ active, counts, onSelect, onClose }: {
  active: RoomViewKind
  counts: Partial<Record<RoomViewKind, number>>
  onSelect(view: RoomViewKind): void
  onClose(): void
}) {
  return (
    <div className="flex h-[50px] shrink-0 items-center gap-1 border-b border-(--border) pl-2 pr-1.5">
      <div role="tablist" aria-label="Sidebar views" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {ROOM_VIEWS.map((view) => {
          const { label, icon: Icon } = VIEW_META[view]
          const selected = view === active
          return (
            <Button key={view} variant="ghost" size="xs" type="button" role="tab" aria-selected={selected} onClick={() => onSelect(view)}
              className={`h-7 shrink-0 gap-1.5 rounded-md px-2.5 text-[12px] font-normal ${
                selected ? 'bg-(--surface-subtle) text-(--foreground)' : 'text-(--muted) hover:bg-(--surface-subtle)/60 hover:text-(--foreground)'
              }`}>
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
              {label}
              {counts[view] ? <span className="text-[11px] text-(--muted-light)">{counts[view]}</span> : null}
            </Button>
          )
        })}
      </div>
      <Button variant="ghost" size="icon-xs" type="button" aria-label="Close sidebar" title="Close sidebar" onClick={onClose}
        className="shrink-0 text-(--muted)">
        <X />
      </Button>
    </div>
  )
}
