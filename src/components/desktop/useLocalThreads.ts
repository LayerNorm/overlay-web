'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DesktopBridge, LocalModelKeys, LocalThread } from '@overlay/desktop-bridge'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { useDesktopBridge } from './DesktopProvider'

/**
 * Private threads live in the desktop app (internal/develop/private-threads.md). These hooks are empty in a browser
 * and in a desktop app too old to run them.
 */
export function useLocalThreadsBridge(): DesktopBridge | null {
  const desktop = useDesktopBridge()
  return desktop?.info.capabilities.includes('localThreads') ? desktop.bridge : null
}

export type LocalThreadOwner = { userId: string; workspaceId: string }

export function useLocalThreadOwner(workspaceId: string | null | undefined): LocalThreadOwner | null {
  const userId = useOptionalAuth()?.user?.id
  return useMemo(() => (userId && workspaceId ? { userId, workspaceId } : null), [userId, workspaceId])
}

/** This person's private threads in this workspace, newest first; null while loading or unavailable. */
export function useLocalThreadList(workspaceId: string | null | undefined): { threads: LocalThread[] | null; running: string[] } {
  const bridge = useLocalThreadsBridge()
  const owner = useLocalThreadOwner(workspaceId)
  const [state, setState] = useState<{ threads: LocalThread[] | null; running: string[] }>({ threads: null, running: [] })

  useEffect(() => {
    if (!bridge || !owner) return
    const refresh = () => bridge.call('localThreads.list', { owner }).then(setState, () => {
      setState((current) => current.threads ? current : { threads: [], running: [] })
    })
    void refresh()
    const offThreads = bridge.on('localThreads.threads', (changed) => {
      if (changed.userId === owner.userId && changed.workspaceId === owner.workspaceId) void refresh()
    })
    const offTurn = bridge.on('localThreads.turn', () => void refresh())
    return () => {
      offThreads()
      offTurn()
    }
  }, [bridge, owner])

  return bridge && owner ? state : NO_THREADS
}

const NO_THREADS: { threads: LocalThread[] | null; running: string[] } = { threads: null, running: [] }

/** Which model providers have a key in this computer's keychain. */
export function useLocalModelKeys() {
  const bridge = useLocalThreadsBridge()
  const [keys, setKeys] = useState<LocalModelKeys | null>(null)
  useEffect(() => {
    if (!bridge) return
    let live = true
    void bridge.call('localThreads.keys', undefined).then((value) => { if (live) setKeys(value) }).catch(() => undefined)
    return () => { live = false }
  }, [bridge])
  const setKey = useCallback(async (provider: keyof LocalModelKeys, apiKey: string | null) => {
    if (!bridge) throw new Error('Open Overlay on this computer to add keys.')
    const next = await bridge.call('localThreads.setKey', { provider, apiKey })
    setKeys(next)
    return next
  }, [bridge])
  return { available: Boolean(bridge), keys, setKey }
}
