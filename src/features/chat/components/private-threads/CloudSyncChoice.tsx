'use client'

import type { ReactNode } from 'react'
import { Check, ChevronDown, Cloud, CloudOff } from 'lucide-react'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@overlay/ui/primitives'

/**
 * Cloud sync for a thread on this computer (internal/develop/private-threads.md): chosen before the first message,
 * fixed after it. "Not synced" runs the agent here and keeps the transcript only on this computer.
 */

function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-light)">{children}</div>
}

function Row({ icon, title, detail, selected }: { icon: ReactNode; title: string; detail: string; selected: boolean }) {
  return (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        <span className="block truncate text-[11px] text-(--muted-light)">{detail}</span>
      </span>
      {selected ? <Check size={13} /> : null}
    </>
  )
}

export function CloudSyncChoice({ synced, disabled, onChoose }: { synced: boolean; disabled?: boolean; onChoose(synced: boolean): void }) {
  const Icon = synced ? Cloud : CloudOff
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" aria-label="Cloud sync" disabled={disabled} className="h-6 max-w-[220px] gap-1.5 px-1.5 text-[11px] font-normal text-(--muted)">
          <Icon size={12} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">{synced ? 'Synced' : 'Not synced'}</span>
          <ChevronDown size={11} className="shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <MenuLabel>Cloud sync</MenuLabel>
        <DropdownMenuItem onSelect={() => { if (!synced) onChoose(true) }} className="gap-2 text-xs">
          <Row icon={<Cloud size={14} strokeWidth={1.75} />} title="Synced" detail="Saved to your workspace" selected={synced} />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { if (synced) onChoose(false) }} className="gap-2 text-xs">
          <Row icon={<CloudOff size={14} strokeWidth={1.75} />} title="Not synced" detail="Runs and stays on this computer" selected={!synced} />
        </DropdownMenuItem>
        <div role="separator" className="my-1 h-px bg-(--border)" />
        <p className="px-2 py-1.5 text-[11px] leading-relaxed text-(--muted-light)">
          Not synced runs with your own model keys and this computer’s tools. The agent’s Overlay tools send only what each call needs; the conversation stays here.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** After the first message the choice is fixed; only a thread that is not synced says so. */
export function NotSyncedLabel() {
  return (
    <span title="Set when the thread started" className="inline-flex h-6 min-w-0 max-w-[220px] items-center gap-1.5 px-1.5 text-[11px] text-(--muted-light)">
      <CloudOff size={12} strokeWidth={1.75} className="shrink-0" />
      <span className="truncate">Not synced</span>
    </span>
  )
}

export function NotSyncedMark() {
  return <CloudOff size={12} strokeWidth={1.75} aria-label="Not synced" className="shrink-0 text-(--muted-light)" />
}
