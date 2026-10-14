import { List, Columns3, ChartGantt } from 'lucide-react'
import { buildScopedPanelNav } from './scopedPanelNav'
import { resolveWorkView } from '@/shared/work/view'
import { type PanelScope } from '@/shared/workspaces/panel-scope'

export function buildWorkPanelNav(args: {
  scope: PanelScope
  params: URLSearchParams
  pendingId: string | null
  solo: boolean
  href: string
  push: (href: string) => void
  close: () => void
  begin: (id: string) => void
}) {
  const views = [
    { id: 'list', label: 'List', icon: List },
    { id: 'board', label: 'Board', icon: Columns3 },
    { id: 'timeline', label: 'Timeline', icon: ChartGantt },
  ]
  const view = resolveWorkView(args.params.get('view'))
  return buildScopedPanelNav({
    scope: args.scope,
    sub: view,
    subItems: { personal: views, workspace: views },
    pendingId: args.pendingId,
    solo: args.solo,
    onSelect: (scope, selected) => {
      const nextView = selected ?? view
      args.close()
      args.begin(`${scope}:${nextView}`)
      const params = new URLSearchParams(args.params)
      params.set('scope', scope)
      params.set('view', nextView)
      params.delete('id')
      args.push(`${args.href}?${params}`)
    },
  })
}
