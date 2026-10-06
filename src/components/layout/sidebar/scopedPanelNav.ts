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
  solo = false,
  soloLabel = 'All',
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
  /**
   * A workspace of one person has nothing to split between Personal and Workspace, so the page's rows stand on their own
   * with Archived below. Without sub-rows the page gets a single row named `soloLabel`. Selections still report the
   * Personal scope, so everything beneath keeps working unchanged.
   */
  solo?: boolean
  soloLabel?: string
  onSelect: (scope: PanelScope, sub: string | null) => void
}): SecondaryPanelNav {
  if (solo) return buildSoloPanelNav({ scope, sub, subItems, pendingId, badges, hiddenScopes, soloLabel, onSelect })
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

function buildSoloPanelNav({
  scope,
  sub,
  subItems,
  pendingId,
  badges,
  hiddenScopes,
  soloLabel,
  onSelect,
}: {
  scope: PanelScope
  sub: string | null
  subItems: ScopedSubItems
  pendingId: string | null
  badges?: Partial<Record<PanelScope, number>>
  hiddenScopes: ReadonlyArray<PanelScope>
  soloLabel: string
  onSelect: (scope: PanelScope, sub: string | null) => void
}): SecondaryPanelNav {
  const kids = subItems.personal ?? []
  const rows: InlineNavItem[] = kids.length > 0
    ? kids.map((kid) => ({ ...kid, id: childId('personal', kid.id) }))
    : [{ id: 'personal', label: soloLabel, icon: User, badgeCount: badges?.personal || undefined }]
  const archived = SCOPE_ROWS.find((row) => row.id === 'archived' && !hiddenScopes.includes(row.id))
  const items = archived ? [...rows, { id: archived.id, label: archived.label, icon: archived.icon }] : rows
  const viewingArchived = scope === 'archived'
  const activeId = viewingArchived
    ? 'archived'
    : kids.length > 0
      ? childId('personal', sub ?? kids[0]!.id)
      : 'personal'
  return {
    items,
    activeId,
    pendingId,
    onSelect: (id) => {
      const child = parseChildId(id)
      const next: PanelScope = child ? child.scope : (id as PanelScope)
      rememberPanelScope(next)
      onSelect(next, child ? child.sub : null)
    },
  }
}
