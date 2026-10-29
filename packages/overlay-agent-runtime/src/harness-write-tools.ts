export const HARNESS_READ_ONLY_TOOL_IDS: ReadonlySet<string> = new Set([
  'deep_search',
  'get_note',
  'get_task',
  'list_agents',
  'list_automations',
  'list_chats',
  'list_files',
  'list_notes',
  'list_skills',
  'list_tasks',
  'read_agent_reply',
  'read_chat',
  'read_file',
  'search_in_files',
  'search_knowledge',
  'search_memory',
  'search_messages',
  'web_fetch',
  'web_search',
  'present_generated_ui',
])

export function harnessToolsRequirePlan(toolNames: readonly string[]): boolean {
  return toolNames.some(name => !HARNESS_READ_ONLY_TOOL_IDS.has(name))
}
