'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LocalComputerStatus } from '@overlay/desktop-bridge'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import { useLiveAgentEnvironments } from '@/hooks/use-connections'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useDesktopBridge } from './DesktopProvider'
import {
  approvedRoots, chooseThisComputerFolder, chosenFolders, ensureThisComputer, isUsableEnvironment,
  removeThisComputerFolder, type ThisComputerDeps,
} from './this-computer'

const STATUS_POLL_MS = 5_000

/**
 * The computer the desktop app is open on. `available` is false in a browser and in a desktop app that can't run
 * threads; everything else is then empty.
 */
export function useThisComputer(workspaceId: string | null | undefined) {
  const desktop = useDesktopBridge()
  const bridge = desktop?.info.capabilities.includes('localComputer') && desktop.info.capabilities.includes('agentHost')
    ? desktop.bridge
    : null
  const environments = useLiveAgentEnvironments()
  const [status, setStatus] = useState<LocalComputerStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!bridge) return
    try {
      setStatus(await bridge.call('localComputer.status', undefined))
    } catch {
      /* Keeps the last known state. */
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), STATUS_POLL_MS)
    const off = bridge.on('agentHost.status', () => void refresh())
    return () => {
      window.clearInterval(timer)
      off()
    }
  }, [bridge, refresh])

  const environment = useMemo<AgentEnvironmentResource | null>(() => {
    const found = environments?.find((entry) => entry.id === status?.environmentId)
    return isUsableEnvironment(found) ? found : null
  }, [environments, status?.environmentId])

  const deps = useMemo<ThisComputerDeps | null>(
    () => (bridge && workspaceId ? { call: bridge.call.bind(bridge), api: overlayAppClient.agentEnvironments, workspaceId } : null),
    [bridge, workspaceId],
  )

  /** Runs one action at a time and refreshes the status afterwards; errors reach the caller. */
  const run = useCallback(async <T,>(action: (deps: ThisComputerDeps) => Promise<T>): Promise<T> => {
    if (!deps) throw new Error('Open the Overlay desktop app to work on this computer.')
    setBusy(true)
    try {
      return await action(deps)
    } finally {
      setBusy(false)
      void refresh()
    }
  }, [deps, refresh])

  const connect = useCallback(() => run((current) => ensureThisComputer(current)), [run])
  const chooseFolder = useCallback(() => run((current) => chooseThisComputerFolder(current)), [run])
  const removeFolder = useCallback(
    (path: string) => run(async (current) => {
      if (environment) await removeThisComputerFolder(current, environment, path)
    }),
    [environment, run],
  )

  // One object per state, so consumers can pass it to memoized views without re-rendering on unrelated updates.
  return useMemo(() => {
    const running = status?.localTools === true && (status.hostState === 'running' || status.hostState === 'starting')
    return {
      /** The desktop app is open and can run threads on this computer. */
      available: bridge !== null,
      bridge,
      status,
      /** Null until this computer connected, and after it was removed. */
      environment,
      environmentId: environment?.id ?? null,
      name: environment?.name ?? status?.computerName ?? null,
      folders: chosenFolders(approvedRoots(environment), status?.workFolder),
      online: running && environment?.status === 'online',
      running,
      busy,
      refresh,
      connect,
      chooseFolder,
      removeFolder,
    }
  }, [bridge, busy, chooseFolder, connect, environment, refresh, removeFolder, status])
}

export type ThisComputer = ReturnType<typeof useThisComputer>
