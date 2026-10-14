import { ChartGantt, List, SquareKanban } from 'lucide-react'
import type { InlineNavItem } from '@/components/layout/AppSidebarInlinePanels'
import { withPanelScope, type PanelScope } from '@/shared/workspaces/panel-scope'
import { WORK_VIEWS, WORK_VIEW_LABELS, WORK_VIEW_PARAM, parseWorkView, type WorkView } from '@/shared/work/views'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'
import { buildScopedPanelNav } from './scopedPanelNav'

interface SidebarRouter {
  push: (href: string) => void
}

const WORK_VIEW_ICONS: Record<WorkView, InlineNavItem['icon']> = { list: List, board: SquareKanban, timeline: ChartGantt }

/** List, Board, and Timeline: the same tasks, three ways. They sit under Personal and under Workspace. */
export const workInlineItems: ReadonlyArray<InlineNavItem> = WORK_VIEWS.map((id) => ({
  id,
  label: WORK_VIEW_LABELS[id],
  icon: WORK_VIEW_ICONS[id],
}))

export function buildWorkPanelNav({
  scope,
  workView,
  effectivePendingSecondaryNavId,
  currentSearchParams,
  canonicalWorkspaceRoute,
  activeWorkspaceId,
  buildWorkspaceHref,
  router,
  closeMobileDrawer,
  beginSecondaryNavigation,
  solo,
}: {
  scope: PanelScope
  workView: WorkView
  effectivePendingSecondaryNavId: string | null
  currentSearchParams: URLSearchParams
  canonicalWorkspaceRoute: boolean
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string) => string
  router: SidebarRouter
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
  solo: boolean
}): SecondaryPanelNav {
  return buildScopedPanelNav({
    scope,
    solo,
    sub: workView,
    subItems: { personal: workInlineItems, workspace: workInlineItems },
    pendingId: effectivePendingSecondaryNavId,
    onSelect: (nextScope, nextSub) => {
      closeMobileDrawer()
      const nextView = parseWorkView(nextSub) ?? workView
      if (nextScope === scope && nextView === workView) return
      beginSecondaryNavigation(nextSub ? `${nextScope}:${nextSub}` : nextScope)
      const params = withPanelScope(new URLSearchParams(currentSearchParams.toString()), nextScope)
      // An open task may not exist in the scope being switched to.
      params.delete('task')
      params.set(WORK_VIEW_PARAM, nextView)
      const href = canonicalWorkspaceRoute && activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, '/app/work')
        : '/app/work'
      router.push(`${href}?${params.toString()}`)
    },
  })
}
