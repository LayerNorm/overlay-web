import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PanelScope } from '@overlay/shell-react'
import {
  readDesktopShellNav,
  writeDesktopShellNav,
  type ActiveTool,
  type DesktopShellNavState,
} from './navigation'

type StateWithWorkspace = DesktopShellNavState & { workspaceId: string | null }

export function useDesktopShellNav(workspaceId: string | null) {
  const [stored, setStored] = useState<StateWithWorkspace>(() => ({
    ...readDesktopShellNav(localStorage, workspaceId),
    workspaceId,
  }))
  const state = useMemo(
    () =>
      stored.workspaceId === workspaceId
        ? stored
        : { ...readDesktopShellNav(localStorage, workspaceId), workspaceId },
    [stored, workspaceId],
  )

  useEffect(() => {
    if (stored.workspaceId === workspaceId) {
      writeDesktopShellNav(localStorage, workspaceId, state)
    }
  }, [state, stored.workspaceId, workspaceId])

  const update = useCallback(
    (patch: Partial<DesktopShellNavState>) => {
      setStored((current) => {
        const base =
          current.workspaceId === workspaceId
            ? current
            : { ...readDesktopShellNav(localStorage, workspaceId), workspaceId }
        return { ...base, ...patch, workspaceId }
      })
    },
    [workspaceId],
  )

  const setPage = useCallback((page: ActiveTool) => update({ page, itemId: null }), [update])
  const setScope = useCallback((scope: PanelScope) => update({ scope }), [update])
  const setItemId = useCallback((itemId: string | null) => update({ itemId }), [update])
  const setSettingsSection = useCallback(
    (settingsSection: string) => update({ settingsSection }),
    [update],
  )
  const setCollapsed = useCallback((collapsed: boolean) => update({ collapsed }), [update])

  return {
    ...state,
    setPage,
    setScope,
    setItemId,
    setSettingsSection,
    setCollapsed,
  }
}
