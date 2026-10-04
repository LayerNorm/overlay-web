/**
 * Capability groups a workspace agent can be granted.
 *
 * Agents run the same tool pipeline as personal chat (`prepareActTooling`), so a
 * group is a filter over that pipeline rather than a separate tool surface. Most
 * groups map to concrete overlay tool ids, stored on the agent as
 * `allowedToolIds`. The remaining surfaces — web search, connected apps, MCP
 * servers — are assembled by provider-specific paths that do not have stable
 * per-tool ids, so those groups carry a `capability` instead and the agent
 * tooling layer filters the assembled tool set by it.
 *
 * A grant only ever narrows. Deployment gates, account policy, and project
 * policy are applied first, so a group can never hand an agent a tool the
 * workspace itself has withheld.
 */
import { COMPUTER_TOOL_IDS } from '@overlay/tools-core/policy'

export type AgentToolCapability = 'web_search' | 'integrations' | 'mcp'

/**
 * The computer group's tool ids — canonical list lives in
 * `@overlay/tools-core/policy` so the global tool registry and this group
 * cannot drift apart; named separately so server gates can withhold them when
 * the deployment's `computers` capability is off.
 */
export { COMPUTER_TOOL_IDS }

export interface AgentToolGroup {
  id: string
  label: string
  description: string
  /** Overlay tool ids this group grants. */
  toolIds: readonly string[]
  /** Non-overlay tool surface this group grants, when it is not id-addressable. */
  capability?: AgentToolCapability
}

export const AGENT_TOOL_GROUPS: readonly AgentToolGroup[] = [
  {
    id: 'memory',
    label: 'Persistent memory',
    description: 'Recall and remember facts across conversations, including the agent\'s own memories.',
    toolIds: ['search_memory', 'search_messages', 'list_chats', 'read_chat', 'save_memory', 'save_memory_batch', 'update_memory', 'delete_memory'],
  },
  {
    id: 'knowledge',
    label: 'Knowledge & file search',
    description: 'Search, list, and read the workspace knowledge base and files.',
    toolIds: ['search_knowledge', 'search_in_files', 'list_files', 'read_file'],
  },
  {
    id: 'files',
    label: 'File editing',
    description: 'Create and edit text files, make folders, and move or rename files.',
    toolIds: ['write_file', 'create_folder', 'move_file'],
  },
  {
    id: 'web_search',
    label: 'Web search',
    description: 'Search the live web for current information.',
    toolIds: [],
    capability: 'web_search',
  },
  {
    id: 'integrations',
    label: 'Connected apps',
    description: 'Use the apps connected to this workspace, such as email, calendar, and issue trackers.',
    toolIds: [],
    capability: 'integrations',
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    description: 'Discover and call tools on connected MCP servers.',
    toolIds: [],
    capability: 'mcp',
  },
  {
    id: 'notes',
    label: 'Notes',
    description: 'Read and write documents in the workspace.',
    toolIds: [
      'list_notes',
      'get_note',
      'create_note',
      'append_to_note',
      'replace_note_section',
      'edit_note',
      'update_note',
      'delete_note',
    ],
  },
  {
    id: 'skills',
    label: 'Skills',
    description: 'List available skills and draft new ones from a conversation.',
    toolIds: ['list_skills', 'draft_skill_from_chat'],
  },
  {
    id: 'automations',
    label: 'Automations',
    description: 'List, draft, create, update, pause, and delete scheduled automations.',
    toolIds: [
      'list_automations',
      'draft_automation_from_chat',
      'create_automation',
      'update_automation',
      'pause_automation',
      'delete_automation',
    ],
  },
  {
    id: 'image',
    label: 'Image generation',
    description: 'Generate images.',
    toolIds: ['generate_image'],
  },
  {
    id: 'video',
    label: 'Video generation',
    description: 'Generate and edit video, animate images, apply motion control.',
    toolIds: [
      'generate_video',
      'generate_video_with_reference',
      'animate_image',
      'apply_motion_control',
      'edit_video',
    ],
  },
  {
    id: 'browser',
    label: 'Browser',
    description: 'Drive an interactive browser session.',
    toolIds: ['interactive_browser_session'],
  },
  {
    id: 'computer',
    label: 'Computer',
    description:
      'Give this agent a persistent cloud desktop — it keeps files, signed-in apps, and a live screen between sessions.',
    toolIds: COMPUTER_TOOL_IDS,
  },
  {
    id: 'agent_chat',
    label: 'Ask other agents',
    description: 'Ask other agents in the workspace for help, read their answers, and post into conversations they share. They act for the same person, under a limit on how far a question can be passed on.',
    toolIds: ['list_agents', 'ask_agent', 'read_agent_reply', 'post_message'],
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Create new agents and update existing ones from conversation.',
    toolIds: ['create_agent', 'update_agent'],
  },
]

/**
 * Capability groups are stored in `allowedToolIds` under a reserved id, since
 * that is the only field an agent definition has for its grant. The prefix
 * keeps them from ever colliding with a real overlay tool id.
 */
const CAPABILITY_GRANT_PREFIX = 'capability:'

export function agentToolCapabilityGrantId(capability: AgentToolCapability): string {
  return `${CAPABILITY_GRANT_PREFIX}${capability}`
}

/** The non-overlay capabilities the given allow-list grants. */
export function agentToolCapabilities(
  allowedToolIds: readonly string[],
): Set<AgentToolCapability> {
  const granted = new Set(allowedToolIds)
  const capabilities = new Set<AgentToolCapability>()
  for (const group of AGENT_TOOL_GROUPS) {
    if (group.capability && granted.has(agentToolCapabilityGrantId(group.capability))) {
      capabilities.add(group.capability)
    }
  }
  return capabilities
}

/**
 * Memory recall arrived after agents were already being granted memory, so a
 * grant saved before then names only the write tools. An agent that can write
 * memory but not read it is the exact failure recall was added to fix, so those
 * grants are read as including recall.
 */
const LEGACY_MEMORY_WRITE_TOOL_IDS = ['save_memory', 'save_memory_batch', 'update_memory', 'delete_memory']

/**
 * Tools added to a group after agents were granted it. A group is enabled only
 * when every one of its tools is granted, so a saved grant is read as holding
 * the tools that joined its group later (file reads joined knowledge search;
 * patch-style note edits joined whole-note updates).
 */
const LATER_GROUP_MEMBERS: ReadonlyArray<{ grantedBy: readonly string[]; adds: readonly string[] }> = [
  { grantedBy: ['search_knowledge', 'search_in_files'], adds: ['list_files', 'read_file'] },
  // Reading chats joined the memory group.
  { grantedBy: ['search_messages'], adds: ['list_chats', 'read_chat'] },
  { grantedBy: ['update_note'], adds: ['append_to_note', 'replace_note_section', 'edit_note'] },
  // Agents that hold the whole toolbox (automations, video, and the browser) can ask other agents.
  { grantedBy: ['create_automation', 'generate_video', 'interactive_browser_session'], adds: ['list_agents', 'ask_agent', 'read_agent_reply', 'post_message'] },
]

export function normalizeAgentToolGrant(allowedToolIds: readonly string[]): string[] {
  const granted = new Set(allowedToolIds)
  if (!granted.has('search_memory') && LEGACY_MEMORY_WRITE_TOOL_IDS.some((id) => granted.has(id))) {
    granted.add('search_memory')
    granted.add('search_messages')
  }
  for (const { grantedBy, adds } of LATER_GROUP_MEMBERS) {
    if (grantedBy.every((id) => granted.has(id))) adds.forEach((id) => granted.add(id))
  }
  return [...granted]
}

/** Which groups are fully granted by the given tool-id allow-list. */
export function enabledAgentToolGroupIds(allowedToolIds: readonly string[]): Set<string> {
  const granted = new Set(normalizeAgentToolGrant(allowedToolIds))
  const result = new Set<string>()
  for (const group of AGENT_TOOL_GROUPS) {
    const hasCapability = group.capability
      ? granted.has(agentToolCapabilityGrantId(group.capability))
      : true
    const hasToolIds = group.toolIds.every((id) => granted.has(id))
    if (hasCapability && hasToolIds && (group.capability || group.toolIds.length > 0)) {
      result.add(group.id)
    }
  }
  return result
}

/** The union of tool ids and capability grants for the given set of enabled group ids. */
export function toolIdsForEnabledGroups(groupIds: ReadonlySet<string>): string[] {
  const ids = new Set<string>()
  for (const group of AGENT_TOOL_GROUPS) {
    if (!groupIds.has(group.id)) continue
    group.toolIds.forEach((id) => ids.add(id))
    if (group.capability) ids.add(agentToolCapabilityGrantId(group.capability))
  }
  return [...ids]
}

/** The overlay tool ids in a grant, with capability grants stripped out. */
export function overlayToolIdsFromGrant(allowedToolIds: readonly string[]): string[] {
  return allowedToolIds.filter((id) => !id.startsWith(CAPABILITY_GRANT_PREFIX))
}

/**
 * What a newly created agent is granted by default: every group except
 * `computer`. Agents should be fully capable out of the box — the computer
 * group stays opt-in because toggling it on provisions a persistent paid
 * machine on save, not just a tool grant.
 */
export const DEFAULT_AGENT_TOOL_GROUP_IDS: readonly string[] = AGENT_TOOL_GROUPS
  .map((group) => group.id)
  .filter((id) => id !== 'computer')

/** Every overlay tool id and capability grant an agent can hold. */
export function allAgentToolGrantIds(): string[] {
  return toolIdsForEnabledGroups(new Set(AGENT_TOOL_GROUPS.map((group) => group.id)))
}

export type AgentToolPreset = 'everything' | 'standard' | 'readonly'

/** One-click tool sets for the new-agent dialog. None includes `computer`, which is its own explicit opt-in. */
export const AGENT_TOOL_PRESETS: Record<AgentToolPreset, readonly string[]> = {
  everything: DEFAULT_AGENT_TOOL_GROUP_IDS,
  standard: ['memory', 'knowledge', 'files', 'web_search', 'notes'],
  readonly: ['knowledge', 'web_search'],
}

/** The preset that exactly matches the enabled groups (ignoring `computer`), or null for a custom mix. */
export function agentToolPresetFor(groupIds: ReadonlySet<string>): AgentToolPreset | null {
  const enabled = [...groupIds].filter((id) => id !== 'computer')
  for (const [preset, ids] of Object.entries(AGENT_TOOL_PRESETS) as Array<[AgentToolPreset, readonly string[]]>) {
    if (ids.length === enabled.length && ids.every((id) => groupIds.has(id))) return preset
  }
  return null
}
