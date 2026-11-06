import type { NativeNotification, ReadAction, UnreadCounts } from '@/components/providers/native-activity-context'

export function overlayReadItems(items: NativeNotification[], entries: ReadAction[]) {
  return items.map(item => {
    const entry = entries.find(entry => entry.kind === 'room' ? item.conversationId === entry.conversationId && (item.eventSequence ?? item.createdAt) <= entry.sequence
      : item.createdAt <= entry.through && (entry.kind === 'all' || entry.ids.includes(item.id)))
    return entry && item.readAt === undefined ? { ...item, readAt: entry.at } : item
  })
}

export function overlayUnreadCounts(counts: UnreadCounts | null, items: NativeNotification[], entries: ReadAction[]) {
  if (!counts) return null
  const read = overlayReadItems(items, entries).filter((item, i) => items[i].readAt === undefined && item.readAt !== undefined)
  const subtract = (value: { count: number; capped: boolean }, count: number) => value.capped ? value : { ...value, count: Math.max(0, value.count - count) }
  const byConversation = Object.fromEntries(Object.entries(counts.byConversation).map(([id, value]) => [id, subtract(value, read.filter(item => item.conversationId === id).length)]))
  const byKind = { ...counts.byKind }
  for (const kind of ['direct', 'channel', 'agentThread'] as const) byKind[kind] = subtract(counts.byKind[kind], read.filter(item => item.destination.kind === kind).length)
  const clearedRooms = Object.entries(counts.byConversation).filter(([id, value]) => value.count > 0 && byConversation[id].count === 0).length
  return { ...counts, byConversation, byKind, rooms: subtract(counts.rooms, clearedRooms), notifications: subtract(counts.notifications, read.length) }
}
