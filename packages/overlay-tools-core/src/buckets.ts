export type ToolCostBucket = 'perplexity' | 'image' | 'video' | 'browser' | 'daytona' | 'composio' | 'internal'

export type ToolBucket = ToolCostBucket

export const INTERNAL_TOOL_IDS = new Set<string>([
  'search_knowledge',
  'search_in_files',
  'save_memory',
  'save_memory_batch',
  'update_memory',
  'delete_memory',
  'list_notes',
  'get_note',
  'create_note',
  'update_note',
  'delete_note',
  'list_skills',
  'draft_skill_from_chat',
  'list_automations',
  'draft_automation_from_chat',
  'create_automation',
  'update_automation',
  'pause_automation',
  'delete_automation',
])

/** Maps tool name -> usage/cost bucket. */
export function toolCostBucketForId(toolId: string): ToolCostBucket {
  if (toolId === 'perplexity_search' || toolId === 'parallel_search') return 'perplexity'
  if (toolId === 'generate_image') return 'image'
  if (
    toolId === 'generate_video' ||
    toolId === 'animate_image' ||
    toolId === 'generate_video_with_reference' ||
    toolId === 'apply_motion_control' ||
    toolId === 'edit_video'
  ) return 'video'
  if (toolId === 'browser_run_task' || toolId === 'interactive_browser_session') return 'browser'
  if (toolId === 'run_daytona_sandbox') return 'daytona'
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
    bucket === 'daytona' ||
    bucket === 'composio'
  )
}
