import { API_TOOL_IDS, COMPUTER_TOOL_IDS } from './policy'

export type ToolCostBucket = 'perplexity' | 'image' | 'video' | 'browser' | 'composio' | 'internal'

export type ToolBucket = ToolCostBucket

export const INTERNAL_TOOL_IDS = new Set<string>([
  ...COMPUTER_TOOL_IDS,
  // run_api is metered as workspace usage when it settles, so it needs no invocation row.
  ...API_TOOL_IDS,
  'search_knowledge',
  'search_in_files',
  'list_files',
  'read_file',
  'write_file',
  'create_folder',
  'move_file',
  'move_to_workspace',
  'archive_item',
  'restore_item',
  'search_memory',
  'search_messages',
  'list_chats',
  'read_chat',
  'save_memory',
  'save_memory_batch',
  'update_memory',
  'delete_memory',
  'list_notes',
  'get_note',
  'create_note',
  'append_to_note',
  'replace_note_section',
  'edit_note',
  'update_note',
  'delete_note',
  'list_skills',
  'find_skills',
  'load_skill',
  'search_skill_registries',
  'save_skill',
  'draft_skill_from_chat',
  'list_automations',
  'list_tasks',
  'get_task',
  'create_task',
  'update_task',
  'comment_on_task',
  'archive_task',
  'restore_task',
  'draft_automation_from_chat',
  'create_automation',
  'update_automation',
  'pause_automation',
  'delete_automation',
  'list_agents',
  'ask_agent',
  'read_agent_reply',
  'resolve_assignment',
  'post_message',
])

/** Maps tool name -> usage/cost bucket. */
export function toolCostBucketForId(toolId: string): ToolCostBucket {
  if (
    toolId === 'perplexity_search' ||
    toolId === 'parallel_search' ||
    toolId === 'web_search' ||
    toolId === 'deep_search' ||
    toolId === 'web_fetch'
  ) return 'perplexity'
  if (toolId === 'generate_image') return 'image'
  if (
    toolId === 'generate_video' ||
    toolId === 'animate_image' ||
    toolId === 'generate_video_with_reference' ||
    toolId === 'apply_motion_control' ||
    toolId === 'edit_video'
  ) return 'video'
  if (INTERNAL_TOOL_IDS.has(toolId)) return 'internal'
  return 'composio'
}

/** Avoid writing a row for every cheap internal read/mutation. */
export function shouldPersistToolInvocation(bucket: ToolCostBucket): boolean {
  return (
    bucket === 'perplexity' ||
    bucket === 'image' ||
    bucket === 'video' ||
    bucket === 'browser' ||
    bucket === 'composio'
  )
}
