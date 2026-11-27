import React, { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Haptics from 'expo-haptics'
import { DEFAULT_PANEL_SCOPE, parsePanelScope } from '../../../src/shared/workspaces/panel-scope'
import { useWorkspace } from './WorkspaceContext'
import { useNativeDataReady } from './ConvexAuthProvider'
import { api, mutateConvex } from '../services/convexClient'
import { setCurrentMode } from '../services/modeState'

/**
 * Workspace or Personal: one switch for the whole app, as on the web
 * (`internal/develop/workspace-and-personal.md`). Workspace is the default; the
 * choice is remembered on this device for each workspace.
 */
export type AppMode = 'personal' | 'workspace'

type ModeContextValue = {
  mode: AppMode
  setMode: (mode: AppMode) => void
}

const ModeContext = createContext<ModeContextValue>({ mode: DEFAULT_PANEL_SCOPE, setMode: () => undefined })

const chiefsEnsured = new Set<string>()

const storageKey = (workspaceId: string) => `overlay:panel-scope:${workspaceId}`

export const MODE_OPTIONS: ReadonlyArray<{ value: AppMode; label: string; icon: 'building.2' | 'person' }> = [
  { value: 'workspace', label: 'Workspace', icon: 'building.2' },
  { value: 'personal', label: 'Personal', icon: 'person' },
]

export function modeIcon(mode: AppMode): 'building.2' | 'person' {
  return mode === 'personal' ? 'person' : 'building.2'
}

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const { activeWorkspaceId } = useWorkspace()
  const [state, setState] = useState<{ workspaceId: string | null; mode: AppMode }>({
    workspaceId: null,
    mode: DEFAULT_PANEL_SCOPE,
  })

  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    AsyncStorage.getItem(storageKey(activeWorkspaceId))
      .catch(() => null)
      .then((stored) => {
        if (!cancelled) setState({ workspaceId: activeWorkspaceId, mode: parsePanelScope(stored) ?? DEFAULT_PANEL_SCOPE })
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

  const mode = state.workspaceId === activeWorkspaceId ? state.mode : DEFAULT_PANEL_SCOPE
  setCurrentMode(mode)

  // Personal and its chief are created the first time someone opens Personal,
  // once the backend has accepted the sign-in (as on the web).
  const ready = useNativeDataReady()
  useEffect(() => {
    if (mode !== 'personal' || !activeWorkspaceId || !ready) return
    const key = `${activeWorkspaceId}:personal`
    if (chiefsEnsured.has(key)) return
    chiefsEnsured.add(key)
    mutateConvex(api.agents.directory.ensureChiefs, { workspaceId: activeWorkspaceId, includePersonal: true }).catch(
      () => chiefsEnsured.delete(key),
    )
  }, [mode, activeWorkspaceId, ready])

  const setMode = useCallback(
    (next: AppMode) => {
      if (!activeWorkspaceId) return
      void Haptics.selectionAsync().catch(() => undefined)
      setState({ workspaceId: activeWorkspaceId, mode: next })
      AsyncStorage.setItem(storageKey(activeWorkspaceId), next).catch(() => undefined)
    },
    [activeWorkspaceId],
  )

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode])
  return <ModeContext value={value}>{children}</ModeContext>
}

export function useMode(): ModeContextValue {
  return use(ModeContext)
}
