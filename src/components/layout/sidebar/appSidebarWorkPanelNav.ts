import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'
import { buildScopedPanelNav } from './scopedPanelNav'
import { withPanelScope, type PanelScope } from '@/shared/workspaces/panel-scope'

interface SidebarRouter {
  push: (href: string) => void
}

/** The Work panel's scope rows — scope only, no sub-rows yet. */
export function buildWorkPanelNav({
  scope,
  effectivePendingSecondaryNavId,
  currentSearchParams,
  publicShowcase,
  canonicalWorkspaceRoute,
  activeWorkspaceId,
  buildWorkspaceHref,
  router,
  closeMobileDrawer,
  beginSecondaryNavigation,
  solo,
}: {
  scope: PanelScope
  effectivePendingSecondaryNavId: string | null
  currentSearchParams: URLSearchParams
  publicShowcase: boolean
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
    soloLabel: 'Work',
    sub: null,
    subItems: {},
    pendingId: effectivePendingSecondaryNavId,
    onSelect: (next) => {
      closeMobileDrawer()
      if (next === scope) return
      beginSecondaryNavigation(next)
      const params = withPanelScope(currentSearchParams, next)
      // Leave an open item behind: it may not exist in the scope being switched to.
      params.delete('item')
      params.delete('itemId')
      if (publicShowcase) params.set('showcase', '1')
      const query = params.toString()
      const href = canonicalWorkspaceRoute && activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, '/app/work')
        : '/app/work'
      router.push(query ? `${href}?${query}` : href)
    },
  })
}
