'use client'

import { useSearchParams } from 'next/navigation'
import { usePanelScope, usePanelListView } from '@/hooks/use-panel-scope'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { WORK_VIEW_PARAM, resolveWorkView, type WorkView } from '@/shared/work/views'

export interface WorkRoute {
  /** Personal or Workspace, from the URL, then the remembered choice. */
  scope: PanelScope
  /** List, Board, or Timeline. */
  view: WorkView
  /** What to ask the API for: undefined (everything active) in a workspace of one person, the scope otherwise. */
  listView: PanelScope | undefined
  /** A workspace of one person has no Personal / Workspace split. */
  solo: boolean
}

/** Where the Work page is, read from the URL so the sidebar, the page and a shared link always agree. */
export function useWorkRoute(): WorkRoute {
  const params = useSearchParams()
  return {
    scope: usePanelScope(),
    view: resolveWorkView(params?.get(WORK_VIEW_PARAM)),
    listView: usePanelListView(),
    solo: useIsSoloWorkspace(),
  }
}
