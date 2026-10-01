export const CHAT_TOOL_REQUEST_IDS = ['web_search', 'memory', 'browser'] as const

export type ChatToolRequestId = (typeof CHAT_TOOL_REQUEST_IDS)[number]

const CHAT_TOOL_REQUEST_ID_SET = new Set<string>(CHAT_TOOL_REQUEST_IDS)

export function isChatToolRequestId(value: unknown): value is ChatToolRequestId {
  return typeof value === 'string' && CHAT_TOOL_REQUEST_ID_SET.has(value)
}

export function normalizeChatToolRequestIds(value: unknown): ChatToolRequestId[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<ChatToolRequestId>()
  const out: ChatToolRequestId[] = []
  for (const item of value) {
    if (!isChatToolRequestId(item) || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

export function defaultChatToolRequestIds(options: { temporary: boolean }): ChatToolRequestId[] {
  if (options.temporary) return []
  return []
}

export function defaultMemoryEnabled(options: { temporary: boolean }): boolean {
  return !options.temporary
}
