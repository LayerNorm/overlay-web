/**
 * Remembers the last opened conversation per Chats subview so switching back
 * to Direct Messages, Channels, or All restores that conversation.
 */

export type RestorableChatListView = 'personal' | 'dms' | 'channels' | 'all'

const STORAGE_KEY = 'overlay:last-chat-by-view'

function isRestorableView(view: string): view is RestorableChatListView {
  return view === 'personal' || view === 'dms' || view === 'channels' || view === 'all'
}

function entryKey(workspaceId: string | null | undefined, view: RestorableChatListView): string {
  return `${workspaceId || 'legacy'}:${view}`
}

function readMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

function writeMap(map: Record<string, string>): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Private browsing / quota — lose the preference rather than crash chrome.
  }
}

export function rememberLastChatForView(
  workspaceId: string | null | undefined,
  view: string,
  chatId: string,
): void {
  if (!chatId || !isRestorableView(view)) return
  const map = readMap()
  map[entryKey(workspaceId, view)] = chatId
  writeMap(map)
}

export function getLastChatForView(
  workspaceId: string | null | undefined,
  view: string,
): string | null {
  if (!isRestorableView(view)) return null
  return readMap()[entryKey(workspaceId, view)] ?? null
}

export function clearLastChatForView(
  workspaceId: string | null | undefined,
  view: string,
  chatId?: string,
): void {
  if (!isRestorableView(view)) return
  const map = readMap()
  const key = entryKey(workspaceId, view)
  if (chatId && map[key] !== chatId) return
  delete map[key]
  writeMap(map)
}
