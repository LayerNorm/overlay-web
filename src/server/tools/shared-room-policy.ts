import 'server-only'

import type { ToolSet } from 'ai'
import { WORKSPACE_TOOL_PREFIX } from '@/shared/integrations/workspace-connector-entity'

/**
 * Overlay tools that read the person's own private material by design, so they are not offered in a room others can read:
 * their chats (`list_chats`, `read_chat`) and the text of their personal files (`search_in_files`, which has no shared copy
 * to search). Everything else that reads is limited to what the workspace shares (see `roomListScope`, `workspaceOnly`).
 */
export const SHARED_ROOM_WITHHELD_TOOL_IDS: ReadonlySet<string> = new Set(['list_chats', 'read_chat', 'search_in_files'])

export function withoutSharedRoomWithheldTools(toolIds: readonly string[]): string[] {
  return toolIds.filter((toolId) => !SHARED_ROOM_WITHHELD_TOOL_IDS.has(toolId))
}

/** The workspace's connected-account tools only (`workspace_…`); the person's own are left out. */
export function workspaceToolsOnly(tools: ToolSet): ToolSet {
  return Object.fromEntries(Object.entries(tools).filter(([name]) => name.startsWith(WORKSPACE_TOOL_PREFIX)))
}
