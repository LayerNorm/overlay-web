/**
 * What another AI app (ChatGPT, Claude, Cursor, a local agent) may do in a
 * workspace once the person connects it to Overlay's MCP server. Each level is a
 * tool grant in the same shape an Overlay agent holds (tool ids and capability
 * grants), so the connected app gets the same tools through the same pipeline and
 * policy as an Overlay agent with that grant: a level can narrow what the
 * workspace allows, never widen it.
 */
import { AGENT_TOOL_GROUPS, normalizeAgentToolGrant, toolIdsForEnabledGroups } from '@/shared/agents/tool-groups'

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
  // An outside app is not one of the workspace's agents, so it has no place in a chain of agents asking agents.
  'list_agents',
  'ask_agent',
  'read_agent_reply',
]

/**
 * Where each Overlay tool group stands over MCP, for the two ways Overlay is offered as an MCP server.
 * A group is either exposed (its tools reach the client, at the access levels above) or withheld for
 * a stated reason. `src/server/mcp/mcp-coverage.test.ts` fails when a group is added to
 * `AGENT_TOOL_GROUPS` without being placed here, so a new capability cannot silently miss MCP.
 */
export type McpGroupCoverage = { exposed: true } | { exposed: false; reason: string }

export const MCP_GROUP_COVERAGE: {
  /** Connected agents (Claude Code, Codex, … on their own machine or an Overlay Cloud machine), grant-limited per agent. */
  connectedAgents: Record<string, McpGroupCoverage>
  /** Outside AI apps (ChatGPT, Claude, Cursor…) at the Everything level. */
  externalApps: Record<string, McpGroupCoverage>
} = {
  connectedAgents: {
    memory: { exposed: true }, knowledge: { exposed: true }, files: { exposed: true }, web_search: { exposed: true },
    integrations: { exposed: true }, mcp: { exposed: true }, notes: { exposed: true }, skills: { exposed: true },
    automations: { exposed: true }, image: { exposed: true }, video: { exposed: true }, browser: { exposed: true },
    agents: { exposed: true }, agent_chat: { exposed: true },
    computer: { exposed: false, reason: 'The agent already runs on a machine of its own; a second computer would only duplicate it.' },
  },
  externalApps: {
    memory: { exposed: true }, knowledge: { exposed: true }, files: { exposed: true }, web_search: { exposed: true },
    integrations: { exposed: true }, mcp: { exposed: true }, notes: { exposed: true }, skills: { exposed: true },
    automations: { exposed: true }, image: { exposed: true }, video: { exposed: true }, browser: { exposed: true },
    agents: { exposed: false, reason: 'Editing agents would let an outside app rewrite what Overlay\'s own agents may do.' },
    agent_chat: { exposed: false, reason: 'Asking agents needs an agent identity to attribute and limit the chain; an outside app is not an agent of the workspace.' },
    computer: { exposed: false, reason: 'A paid desktop that belongs to the person\'s agents, not something an outside app should start.' },
  },
}

/**
 * The access level an agent's saved tool grant amounts to: `none` when it holds no tools, a level when it matches
 * one exactly, `custom` for anything else (set before levels existed, or by hand).
 */
export function mcpAccessForGrant(allowedToolIds: readonly string[]): McpAccessLevel | 'none' | 'custom' {
  if (allowedToolIds.length === 0) return 'none'
  // Read as the tools a grant is understood to hold, so a level saved before a tool joined it still reads as that level.
  const held = new Set(normalizeAgentToolGrant(allowedToolIds))
  // Highest level whose grant is exactly what is held.
  for (const level of [...MCP_ACCESS_LEVELS].reverse()) {
    const grant = mcpToolGrantFor(level)
    if (grant.length === held.size && grant.every((id) => held.has(id))) return level
  }
  return 'custom'
}

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
