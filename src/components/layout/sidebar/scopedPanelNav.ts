import { User, Users } from 'lucide-react'
import type { InlineNavItem } from '@/components/layout/AppSidebarInlinePanels'
import { rememberPanelScope } from '@/hooks/use-panel-scope'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'

/** The two rows every scoped secondary panel starts with, in this order. Archived items live in Settings → Archived. */
const SCOPE_ROWS: ReadonlyArray<{ id: PanelScope; label: string; icon: InlineNavItem['icon'] }> = [
  { id: 'personal', label: 'Personal', icon: User },
  { id: 'workspace', label: 'Workspace', icon: Users },
]

/** Sub-rows per scope. A scope with none shows no children. */
export type ScopedSubItems = Partial<Record<'personal' | 'workspace', ReadonlyArray<InlineNavItem>>>

const childId = (scope: PanelScope, sub: string) => `${scope}:${sub}`

function parseChildId(id: string): { scope: PanelScope; sub: string } | null {
  const [scope, ...rest] = id.split(':')
  if ((scope === 'personal' || scope === 'workspace') && rest.length > 0) return { scope, sub: rest.join(':') }
  return null
}

/**
 * Builds the shared panel navigation: Personal and Workspace, with the page's sub-rows opened beneath the
 * selected scope. `onSelect` gets the scope and, for a sub-row, its id (null for a scope row). The choice is
 * remembered here so the next page opens on the same scope.
 */
export function buildScopedPanelNav({
  scope,
  sub,
  subItems,
  pendingId,
  badges,
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
  /**
   * A workspace of one person has nothing to split between Personal and Workspace, so the page's rows stand on their own.
   * Without sub-rows the page gets a single row named `soloLabel`. Selections still report the
   * Personal scope, so everything beneath keeps working unchanged.
   */
  solo?: boolean
  soloLabel?: string
  onSelect: (scope: PanelScope, sub: string | null) => void
}): SecondaryPanelNav {
  if (solo) return buildSoloPanelNav({ sub, subItems, pendingId, badges, soloLabel, onSelect })
  const items: InlineNavItem[] = SCOPE_ROWS.map((row) => {
    const kids = subItems[row.id] ?? []
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
  sub,
  subItems,
  pendingId,
  badges,
  soloLabel,
  onSelect,
}: {
  sub: string | null
  subItems: ScopedSubItems
  pendingId: string | null
  badges?: Partial<Record<PanelScope, number>>
  soloLabel: string
  onSelect: (scope: PanelScope, sub: string | null) => void
}): SecondaryPanelNav {
  const kids = subItems.personal ?? []
  const rows: InlineNavItem[] = kids.length > 0
    ? kids.map((kid) => ({ ...kid, id: childId('personal', kid.id) }))
    : [{ id: 'personal', label: soloLabel, icon: User, badgeCount: badges?.personal || undefined }]
  const activeId = kids.length > 0 ? childId('personal', sub ?? kids[0]!.id) : 'personal'
  return {
    items: rows,
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
