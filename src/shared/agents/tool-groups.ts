/**
 * Capability groups a workspace agent can be granted, each mapping to the
 * concrete overlay tool ids `buildOverlayToolSet` exposes. Agents run the same
 * tool pipeline as personal chat, filtered to the union of the granted groups'
 * tool ids (stored on the agent as `allowedToolIds`).
 *
 * Only tools that the agent invocation actually wires belong here — web search,
 * MCP servers and third-party integrations run through separate gateway/provider
 * paths and are intentionally excluded until those are wired for agents.
 */
export interface AgentToolGroup {
  id: string
  label: string
  description: string
  toolIds: readonly string[]
}

export const AGENT_TOOL_GROUPS: readonly AgentToolGroup[] = [
  {
    id: 'memory',
    label: 'Persistent memory',
    description: 'Remember facts across conversations and recall them later.',
    toolIds: ['save_memory', 'save_memory_batch', 'update_memory', 'delete_memory'],
  },
  {
    id: 'knowledge',
    label: 'Knowledge & file search',
    description: 'Search the workspace knowledge base and uploaded files.',
    toolIds: ['search_knowledge', 'search_in_files'],
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

/** Which groups are fully granted by the given tool-id allow-list. */
export function enabledAgentToolGroupIds(allowedToolIds: readonly string[]): Set<string> {
  const granted = new Set(allowedToolIds)
  const result = new Set<string>()
  for (const group of AGENT_TOOL_GROUPS) {
    if (group.toolIds.every((id) => granted.has(id))) result.add(group.id)
  }
  return result
}

/** The union of tool ids for the given set of enabled group ids. */
export function toolIdsForEnabledGroups(groupIds: ReadonlySet<string>): string[] {
  const ids = new Set<string>()
  for (const group of AGENT_TOOL_GROUPS) {
    if (groupIds.has(group.id)) group.toolIds.forEach((id) => ids.add(id))
  }
  return [...ids]
}
