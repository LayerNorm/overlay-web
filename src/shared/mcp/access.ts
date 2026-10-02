/**
 * What another AI app (ChatGPT, Claude, Cursor, a local agent) may do in a
 * workspace once the person connects it to Overlay's MCP server. Each level is a
 * tool grant in the same shape an Overlay agent holds (tool ids and capability
 * grants), so the connected app gets the same tools through the same pipeline and
 * policy as an Overlay agent with that grant: a level can narrow what the
 * workspace allows, never widen it.
 */
import { AGENT_TOOL_GROUPS, toolIdsForEnabledGroups } from '@/shared/agents/tool-groups'

export const MCP_ACCESS_LEVELS = ['read', 'write', 'full'] as const
export type McpAccessLevel = (typeof MCP_ACCESS_LEVELS)[number]

export const MCP_ACCESS_LABEL: Record<McpAccessLevel, string> = {
  read: 'Read only',
  write: 'Read and write',
  full: 'Everything',
}

export const MCP_ACCESS_DESCRIPTION: Record<McpAccessLevel, string> = {
  read: 'Search and read your memory, knowledge, files, and notes. Nothing is changed or spent.',
  write: 'Read, plus create and edit notes, files, memory, and skills, and search the web.',
  full: 'Write, plus automations, connected apps, your MCP servers, image and video generation, and the browser. Never agents or computers.',
}

/** Tools that only read. Group membership alone cannot express "read": a group mixes both. */
const READ_TOOL_IDS = [
  'search_memory', 'search_messages',
  'search_knowledge', 'search_in_files', 'list_files', 'read_file',
  'list_notes', 'get_note',
  'list_skills',
  'list_automations',
] as const

const WRITE_GROUP_IDS = ['memory', 'knowledge', 'files', 'notes', 'skills', 'web_search'] as const

/** Never offered to an outside app: it has its own machine, and these need an Overlay conversation to act on. */
export const MCP_EXTERNAL_WITHHELD_TOOL_IDS: readonly string[] = [
  'present_generated_ui',
  'draft_skill_from_chat',
  'draft_automation_from_chat',
  // Changing agents would let an outside app rewrite what Overlay's own agents may do.
  'create_agent',
  'update_agent',
]

export function isMcpAccessLevel(value: unknown): value is McpAccessLevel {
  return typeof value === 'string' && (MCP_ACCESS_LEVELS as readonly string[]).includes(value)
}

/** The tool grant for an access level. */
export function mcpToolGrantFor(access: McpAccessLevel): string[] {
  if (access === 'read') return [...READ_TOOL_IDS]
  // Every level contains the one below it, including read tools whose group is not otherwise granted.
  if (access === 'write') return [...new Set([...READ_TOOL_IDS, ...toolIdsForEnabledGroups(new Set(WRITE_GROUP_IDS))])]
  return toolIdsForEnabledGroups(new Set(AGENT_TOOL_GROUPS.map((group) => group.id).filter((id) => id !== 'computer' && id !== 'agents')))
}
