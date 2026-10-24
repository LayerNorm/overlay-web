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
  /** The API list view follows the selected scope for every workspace. */
  listView: PanelScope
  /** The workspace's member count, independent of selected scope. */
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
