/** Max model tool rounds - ToolLoopAgent (act) uses this. */
export const MAX_TOOL_STEPS_ACT = 12

export const GENERATION_TOOL_IDS = [
  'generate_image',
  'generate_video',
  'animate_image',
  'generate_video_with_reference',
  'apply_motion_control',
  'edit_video',
] as const

export const OVERLAY_TOOL_IDS = [
  'search_knowledge',
  'search_in_files',
  'save_memory',
  'save_memory_batch',
  'update_memory',
  'delete_memory',
  'browser_run_task',
  'interactive_browser_session',
  'run_daytona_sandbox',
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
  ...GENERATION_TOOL_IDS,
] as const

const OVERLAY_TOOL_ID_SET = new Set<string>(OVERLAY_TOOL_IDS)

export function overlayToolIdSet(): ReadonlySet<string> {
  return OVERLAY_TOOL_ID_SET
}

function containsToolId(toolIds: ReadonlySet<string> | readonly string[], toolId: string): boolean {
  if (toolIds instanceof Set) return toolIds.has(toolId)
  return (toolIds as readonly string[]).includes(toolId)
}

/** Defense in depth: ensure a tool id is globally registered and exposed for this turn. */
export function assertOverlayToolAllowed(
  toolId: string,
  allowedToolIds?: ReadonlySet<string> | readonly string[] | null,
): void {
  if (!OVERLAY_TOOL_ID_SET.has(toolId)) {
    throw new Error(`[tools] Tool "${toolId}" is not allowed`)
  }
  if (allowedToolIds && !containsToolId(allowedToolIds, toolId)) {
    throw new Error(`[tools] Tool "${toolId}" is not exposed for this turn`)
  }
}
