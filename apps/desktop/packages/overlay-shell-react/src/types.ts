import type { LucideIcon } from 'lucide-react'

export type PanelScope = 'personal' | 'workspace'

export interface InlineNavItem {
  id: string
  label: string
  icon?: LucideIcon
  locked?: boolean
  href?: string
  badgeCount?: number
  children?: ReadonlyArray<InlineNavItem>
  expanded?: boolean
}

export interface PrimaryRailItem {
  id: string
  label: string
  icon: LucideIcon
  active?: boolean
  pending?: boolean
  disabled?: boolean
  badgeCount?: number
  href?: string
  title?: string
  dataTour?: string
  onSelect: () => void
}

export interface SecondaryPanelNav {
  id?: string
  items: ReadonlyArray<InlineNavItem>
  activeId: string
  activeChildId?: string
  pendingId?: string | null
  onSelect: (id: string) => void
}

export type WorkspaceLifecycleStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ShellWorkspace {
  id: string
  name: string
  role?: string
  iconUrl?: string | null
  iconPreset?: string | null
  memberLabel?: string | null
}
