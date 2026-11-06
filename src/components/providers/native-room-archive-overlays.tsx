'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { NativeRoomSummary } from './native-collaboration-context'
import { settleIntents } from './native-intent-overlays'

type Entry = { id: string; archived: boolean; at: number; settled?: boolean }
type Entries = Record<string, Entry[]>
const Context = createContext<{ entries: Entries; add(room: string, archived: boolean): string; remove(room: string, id: string, committed?: boolean): void }>({ entries: {}, add: () => '', remove() {} })
export const useRoomArchiveOverlays = () => useContext(Context)

export function NativeRoomArchiveOverlayProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entries>({})
  const add = useCallback((room: string, archived: boolean) => {
    const id = crypto.randomUUID()
    const entry = { id, archived, at: Date.now() }
    setEntries(current => ({ ...current, [room]: [...(current[room] ?? []), entry] }))
    return id
  }, [])
  const remove = useCallback((room: string, id: string, committed = false) => setEntries(current => {
    const next = { ...current }
    const rows = settleIntents(next[room] ?? [], id, committed)
    if (rows.length) next[room] = rows; else delete next[room]
    return next
  }), [])
  return <Context.Provider value={{ entries, add, remove }}>{children}</Context.Provider>
}

export function archiveOverlayRows(active: NativeRoomSummary[], archived: NativeRoomSummary[], entries: Entries, wantArchived: boolean) {
  const rows = new Map([...active, ...archived].map(row => [row.conversationId, row]))
  return [...rows.values()].flatMap(row => {
    const entry = entries[row.conversationId]?.at(-1)
    const archivedAt = entry ? entry.archived ? entry.at : undefined : row.archivedAt
    return (archivedAt !== undefined) === wantArchived ? [{ ...row, archivedAt }] : []
  }).sort((a, b) => b.lastModified - a.lastModified || String(a.conversationId).localeCompare(String(b.conversationId)))
}
