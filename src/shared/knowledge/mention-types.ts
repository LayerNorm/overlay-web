/** @-mention token types (shared between chat UI and server parsers). */

export type MentionType = 'file' | 'connector' | 'automation' | 'skill' | 'mcp' | 'chat' | 'person'

export interface MentionItem {
  type: MentionType
  id: string
  name: string
  description?: string
  photoUrl?: string
  principalType?: 'human' | 'agent' | 'service'
  avatarColor?: string
  avatarShape?: string
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
