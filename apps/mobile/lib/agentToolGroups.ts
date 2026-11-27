/**
 * Capability groups a workspace agent can be granted.
 *
 * Mobile-local mirror of web `src/shared/agents/tool-groups.ts` — keep the
 * group ids, tool ids, labels, and default set in sync. The web module imports
 * `COMPUTER_TOOL_IDS` from `@overlay/tools-core/policy`; we inline it here to
 * avoid pulling the whole tools package into the RN bundle.
 */

export type AgentToolCapability = 'web_search' | 'integrations' | 'mcp'

/** Mirrors `COMPUTER_TOOL_IDS` in `@overlay/tools-core/policy`. */
export const COMPUTER_TOOL_IDS = [
  'computer_exec',
  'computer_read_file',
  'computer_write_file',
  'computer_list_files',
  'computer_open_url',
] as const

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
  {
    id: 'computer',
    label: 'Computer',
    description:
      'Give this agent a persistent cloud desktop — it keeps files, signed-in apps, and a live screen between sessions.',
    toolIds: COMPUTER_TOOL_IDS,
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

/**
 * What a newly created agent is granted by default: every group except
 * `computer`. Agents should be fully capable out of the box — the computer
 * group stays opt-in because toggling it on provisions a persistent paid
 * machine on save, not just a tool grant.
 */
export const DEFAULT_AGENT_TOOL_GROUP_IDS: readonly string[] = AGENT_TOOL_GROUPS
  .map((group) => group.id)
  .filter((id) => id !== 'computer')
