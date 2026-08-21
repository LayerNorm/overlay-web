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
export type AgentToolCapability = 'web_search' | 'integrations' | 'mcp'

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
    toolIds: ['search_memory', 'save_memory', 'save_memory_batch', 'update_memory', 'delete_memory'],
  },
  {
    id: 'knowledge',
    label: 'Knowledge & file search',
    description: 'Search the workspace knowledge base and uploaded files.',
    toolIds: ['search_knowledge', 'search_in_files'],
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
    toolIds: ['list_notes', 'get_note', 'create_note', 'update_note', 'delete_note'],
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
    id: 'sandbox',
    label: 'Code sandbox',
    description: 'Run code in an isolated Daytona sandbox.',
    toolIds: ['run_daytona_sandbox'],
  },
  {
    id: 'browser',
    label: 'Browser',
    description: 'Drive an interactive browser session.',
    toolIds: ['interactive_browser_session'],
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

export function normalizeAgentToolGrant(allowedToolIds: readonly string[]): string[] {
  const granted = new Set(allowedToolIds)
  if (!granted.has('search_memory') && LEGACY_MEMORY_WRITE_TOOL_IDS.some((id) => granted.has(id))) {
    granted.add('search_memory')
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
 * What a newly created agent is granted by default.
 *
 * An agent that starts with nothing checked reads as broken: it answers every
 * question from the model alone and cannot look anything up. These are the
 * groups that make an agent useful without letting it spend money, run code,
 * or reach outside the workspace on its first turn — the rest stay opt-in.
 */
export const DEFAULT_AGENT_TOOL_GROUP_IDS: readonly string[] = [
  'memory',
  'knowledge',
  'notes',
  'skills',
]

/** Every overlay tool id and capability grant an agent can hold. */
export function allAgentToolGrantIds(): string[] {
  return toolIdsForEnabledGroups(new Set(AGENT_TOOL_GROUPS.map((group) => group.id)))
}
