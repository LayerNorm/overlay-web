import type { Feather } from '@expo/vector-icons'
import type { ChatMentionItem, ChatMentionType } from '../services/chatTypes'

/** Display metadata per mention type — icons mirror the web mention palette. */
export const MENTION_TYPE_META: Record<
  ChatMentionType,
  { label: string; featherIcon: React.ComponentProps<typeof Feather>['name'] }
> = {
  file: { label: 'Files', featherIcon: 'file-text' },
  connector: { label: 'Apps', featherIcon: 'grid' },
  automation: { label: 'Automations', featherIcon: 'zap' },
  skill: { label: 'Skills', featherIcon: 'star' },
  mcp: { label: 'MCP servers', featherIcon: 'server' },
  chat: { label: 'Chats', featherIcon: 'message-square' },
  person: { label: 'People', featherIcon: 'user' },
  agent: { label: 'Agents', featherIcon: 'cpu' },
}

export function mentionIcon(type: ChatMentionType): React.ComponentProps<typeof Feather>['name'] {
  return MENTION_TYPE_META[type]?.featherIcon ?? 'at-sign'
}

/** Grouped mention results for sectioned display, in stable category order. */
export function groupMentions(items: ChatMentionItem[]): Array<{
  type: ChatMentionType
  label: string
  items: ChatMentionItem[]
}> {
  const order: ChatMentionType[] = ['file', 'chat', 'automation', 'skill', 'mcp', 'connector', 'agent', 'person']
  const byType = new Map<ChatMentionType, ChatMentionItem[]>()
  for (const item of items) {
    const list = byType.get(item.type) ?? []
    list.push(item)
    byType.set(item.type, list)
  }
  return order
    .filter((type) => (byType.get(type)?.length ?? 0) > 0)
    .map((type) => ({ type, label: MENTION_TYPE_META[type].label, items: byType.get(type)! }))
}

/** Body value sent on the act request — `{type, id, name}` per the API schema. */
export function mentionToRequestBody(item: ChatMentionItem): {
  type: string
  id: string
  name: string
} {
  return { type: item.type, id: item.id, name: item.name }
}
