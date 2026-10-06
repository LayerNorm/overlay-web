import { Archive, User, Users } from 'lucide-react'
import type { InlineNavItem } from '@/components/layout/AppSidebarInlinePanels'
import { rememberPanelScope } from '@/hooks/use-panel-scope'
import { scopeHasSubRows, type PanelScope } from '@/shared/workspaces/panel-scope'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'

/** The three rows every scoped secondary panel starts with, in this order. */
const SCOPE_ROWS: ReadonlyArray<{ id: PanelScope; label: string; icon: InlineNavItem['icon'] }> = [
  { id: 'personal', label: 'Personal', icon: User },
  { id: 'workspace', label: 'Workspace', icon: Users },
  { id: 'archived', label: 'Archived', icon: Archive },
]

/** Sub-rows per scope. A scope with none (and Archived, always) shows no children. */
export type ScopedSubItems = Partial<Record<'personal' | 'workspace', ReadonlyArray<InlineNavItem>>>

const childId = (scope: PanelScope, sub: string) => `${scope}:${sub}`

function parseChildId(id: string): { scope: PanelScope; sub: string } | null {
  const [scope, ...rest] = id.split(':')
  if ((scope === 'personal' || scope === 'workspace') && rest.length > 0) return { scope, sub: rest.join(':') }
  return null
}

/**
 * Builds the shared panel navigation: Personal, Workspace, Archived, with the page's sub-rows opened beneath the
 * selected scope. `onSelect` gets the scope and, for a sub-row, its id (null for a scope row). The choice is
 * remembered here so the next page opens on the same scope.
 */
export function buildScopedPanelNav({
  scope,
  sub,
  subItems,
  pendingId,
  badges,
  hiddenScopes = [],
  onSelect,
}: {
  scope: PanelScope
  /** The selected sub-row id within `scope`; null when the page has none. */
  sub: string | null
  subItems: ScopedSubItems
  pendingId: string | null
  /** Unread counts shown on a scope row, which matter while its sub-rows are collapsed. */
  badges?: Partial<Record<PanelScope, number>>
  hiddenScopes?: ReadonlyArray<PanelScope>
  onSelect: (scope: PanelScope, sub: string | null) => void
}): SecondaryPanelNav {
  const items: InlineNavItem[] = SCOPE_ROWS.filter((row) => !hiddenScopes.includes(row.id)).map((row) => {
    const kids = scopeHasSubRows(row.id) ? subItems[row.id] ?? [] : []
    const expanded = row.id === scope && kids.length > 0
    return {
      id: row.id,
      label: row.label,
      icon: row.icon,
      badgeCount: expanded ? undefined : badges?.[row.id] || undefined,
      expanded,
      children: expanded ? kids.map((kid) => ({ ...kid, id: childId(row.id, kid.id) })) : undefined,
    }
  })
  return {
    items,
    activeId: scope,
    activeChildId: sub ? childId(scope, sub) : undefined,
    pendingId,
    onSelect: (id) => {
      const child = parseChildId(id)
      const next = child ? child.scope : (id as PanelScope)
      rememberPanelScope(next)
      onSelect(next, child ? child.sub : null)
    },
  }
}
