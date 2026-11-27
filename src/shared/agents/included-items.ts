/**
 * Personal items a person @-mentions in a room message to include on purpose. In a room others can read an agent sees
 * only Workspace items; the ones named here are the exception, for the turn that message starts
 * (internal/develop/tool-catalog.md, "Rooms others can read").
 */
export type IncludedItem = { type: 'file' | 'automation'; id: string; name: string }

export const MAX_INCLUDED_ITEMS = 10

const INCLUDABLE_TYPES = new Set(['file', 'automation'])

/** The includable mentions of a request body: known types, string ids, deduplicated, at most `MAX_INCLUDED_ITEMS`. */
export function parseIncludedItems(value: unknown): IncludedItem[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const items: IncludedItem[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { type, id, name } = entry as Record<string, unknown>
    if (typeof type !== 'string' || !INCLUDABLE_TYPES.has(type) || typeof id !== 'string' || !id.trim()) continue
    if (seen.has(id)) continue
    seen.add(id)
    items.push({ type: type as IncludedItem['type'], id: id.trim(), name: typeof name === 'string' ? name.trim().slice(0, 200) : '' })
    if (items.length === MAX_INCLUDED_ITEMS) break
  }
  return items
}

/** The prompt lines that tell an agent which Personal items it may open this turn, or nothing. */
export function includedItemsPrompt(items: readonly IncludedItem[]): string {
  if (items.length === 0) return ''
  const lines = items.map((item) => `- ${item.type} id=${item.id} name="${item.name.replace(/"/g, "'")}"`)
  return [
    '<included_personal_items>',
    'The person who asked included these items of theirs in this message, on purpose. You may read and use them here even',
    'though they are Personal; everyone in this room will see your reply. No other Personal item is available.',
    ...lines,
    '</included_personal_items>',
  ].join('\n')
}

/** The items a room message included, only when a person wrote it (an agent's message never widens what is reachable). */
export function includedItemsOfMessage(message: { authorKind?: string; includedItems?: readonly IncludedItem[] } | undefined): IncludedItem[] {
  return message?.authorKind === 'human' ? [...(message.includedItems ?? [])].slice(0, MAX_INCLUDED_ITEMS) : []
}
