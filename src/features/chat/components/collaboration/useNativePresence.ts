'use client'

import { useEffect, useState } from 'react'
import { useQueries } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

type Rows = NonNullable<FunctionReturnType<typeof api.collaboration.nativePresence.watchPresence>>
export function visiblePresence(rows: Rows, now: number) {
  const groups = new Map<string, Rows>()
  for (const row of rows) {
    if (row.status === 'offline' || row.expiresAt <= now) continue
    groups.set(row.principalId, [...(groups.get(row.principalId) ?? []), row])
  }
  return [...groups.values()].map(sessions => ({ ...sessions.reduce((latest, row) => row.lastSeenAt > latest.lastSeenAt ? row : latest),
    typingExpiresAt: Math.max(...sessions.map(row => row.typingExpiresAt ?? 0)) || undefined,
    status: sessions.some(row => row.status === 'online') ? 'online' as const : 'away' as const,
    typing: sessions.some(row => (row.typingExpiresAt ?? 0) > now) }))
}

export function usePresenceDeadlines(rows: Rows | null | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      const current = Date.now()
      setNow(current)
      const deadlines = (rows ?? []).flatMap(row => row.status === 'offline' ? [] : [row.expiresAt, row.typingExpiresAt ?? 0]).filter(at => at > current)
      if (deadlines.length) timer = setTimeout(tick, Math.max(1, Math.min(...deadlines) - current))
    }
    tick()
    return () => { if (timer !== undefined) clearTimeout(timer) }
  }, [rows])
  return visiblePresence(rows ?? [], now)
}

export function useNativePresence(workspaceId: string, conversationId: string, enabled: boolean) {
  const result = useQueries(enabled ? { presence: { query: api.collaboration.nativePresence.watchPresence,
    args: { workspaceId, conversationId: conversationId as Id<'conversations'> } } } : {}).presence
  return usePresenceDeadlines(enabled && Array.isArray(result) ? result as Rows : null)
}
