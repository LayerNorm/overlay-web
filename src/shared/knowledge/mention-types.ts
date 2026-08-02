/** @-mention token types (shared between chat UI and server parsers). */

export type MentionType = 'file' | 'connector' | 'automation' | 'skill' | 'mcp' | 'chat'

export interface MentionItem {
  type: MentionType
  id: string
  name: string
  description?: string
  icon?: string
  logoUrl?: string
  meta?: Record<string, unknown>
}

export interface MentionCategory {
  type: MentionType
  label: string
  icon: string
  items: MentionItem[]
}

export interface ResolvedMention {
  type: MentionType
  id: string
  name: string
  fileIds?: string[]
}
