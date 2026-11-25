// The source file, not the package: Convex's bundler and the admin app resolve workspace packages through their
// entry points, and the protocol's entry point is its build output, which exists only when the package is published.
import { computerActionRequiresApproval, computerToolRequiresApproval } from '../../overlay-agent-bridge-protocol/src/computer-tools'

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

/**
 * Persistent-computer tool ids, also listed in src/shared/agents/tool-groups.ts
 * for the agent Computer group — this package cannot import app code, so the
 * two lists must stay in sync.
 */
export const COMPUTER_TOOL_IDS = [
  'computer_exec',
  'computer_read_file',
  'computer_write_file',
  'computer_list_files',
  'computer_open_url',
  'computer_screenshot',
  'computer_input',
  'computer_browser',
  'computer_terminal',
  'computer_publish_file',
  'computer_recording',
] as const

export const OVERLAY_TOOL_IDS = [
  'search_knowledge',
  'search_in_files',
  'list_files',
  'read_file',
  'write_file',
  'create_folder',
  'move_file',
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
  'draft_automation_from_chat',
  'create_automation',
  'update_automation',
  'pause_automation',
  'delete_automation',
  'list_tasks',
  'get_task',
  'create_task',
  'update_task',
  'comment_on_task',
  'archive_task',
  'restore_task',
  'create_agent',
  'update_agent',
  'list_agents',
  'ask_agent',
  'read_agent_reply',
  'resolve_assignment',
  'post_message',
  ...COMPUTER_TOOL_IDS,
  ...GENERATION_TOOL_IDS,
] as const

const OVERLAY_TOOL_ID_SET = new Set<string>(OVERLAY_TOOL_IDS)

export { computerActionRequiresApproval }

export function toolRequiresApproval(
  toolName: string,
  input: unknown,
  options: {
    approvalMode?: 'ask' | 'auto'
    executorRequiresApproval?: boolean
  } = {},
): boolean {
  if (options.approvalMode === 'auto') return false
  // Computer tool rules are shared with private threads in the Agent Host.
  if (computerToolRequiresApproval(toolName, input)) return true
  if (toolName === 'EXECUTOR_EXECUTE_TOOL') return options.executorRequiresApproval !== false
  return false
}

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
