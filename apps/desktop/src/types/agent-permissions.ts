export const CHAT_TOOL_PERMISSION_MODES = ['ask_for_approval', 'full_access'] as const

export type ChatToolPermissionMode = (typeof CHAT_TOOL_PERMISSION_MODES)[number]

export const DEFAULT_CHAT_TOOL_PERMISSION_MODE: ChatToolPermissionMode = 'ask_for_approval'

export function isChatToolPermissionMode(value: unknown): value is ChatToolPermissionMode {
  return (
    typeof value === 'string' && (CHAT_TOOL_PERMISSION_MODES as readonly string[]).includes(value)
  )
}

export function normalizeChatToolPermissionMode(value: unknown): ChatToolPermissionMode {
  return isChatToolPermissionMode(value) ? value : DEFAULT_CHAT_TOOL_PERMISSION_MODE
}
