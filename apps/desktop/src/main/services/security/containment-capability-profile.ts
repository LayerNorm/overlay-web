/**
 * Phase 0 containment profile.
 *
 * High-risk local capabilities remain implemented. Packaged browser, notebook,
 * voice, and generic renderer IPC stay unavailable until their later gates
 * pass. Desktop chat has a documented owner-approved exception: local tools are
 * available only through the Phase 3 policy wrapper and the main-owned Ask for
 * approval / Full access setting. Development builds still require explicit
 * opt-in for every other surface.
 */

type ToolRegistry = Record<string, unknown>
type AgentSurface = 'chat' | 'browser' | 'notebook' | 'voice'
type ChatToolPermissionMode = 'ask_for_approval' | 'full_access'

const DENIED_TOOL_PREFIXES = [
  'browser_',
  'headless_',
  'terminal_',
  'fs_',
  'code_',
  'ax_',
  'shortcuts_',
  'COMPOSIO_'
] as const

const DENIED_TOOL_NAMES = new Set([
  'fetch_url_content',
  'open_browser_url',
  'navigate_browser',
  'search_web',
  'web_search_tool',
  'launch_app',
  'search_apps',
  'applescript_run',
  'contacts_search',
  'imessage_send',
  'reminders_create',
  'reminders_list',
  'timer_set',
  'download_file',
  'script_run',
  'install_packages',
  'composio_execute'
])

export function areUnsafeLocalCapabilitiesEnabled(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (isPackaged) return false
  return env.OVERLAY_ENABLE_UNSAFE_LOCAL_CAPABILITIES?.trim() === '1'
}

/**
 * The owner explicitly chose permissioned, unsandboxed host execution for
 * desktop chat while microVM isolation is deferred. Other agent surfaces remain
 * under the Phase 0 containment gate.
 */
export function areChatAgentLocalCapabilitiesEnabled(
  surface: AgentSurface,
  permissionMode: ChatToolPermissionMode,
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (
    surface === 'chat' &&
    (permissionMode === 'ask_for_approval' || permissionMode === 'full_access')
  ) {
    return true
  }
  return areUnsafeLocalCapabilitiesEnabled(isPackaged, env)
}

export function isToolDeniedByContainmentProfile(toolName: string): boolean {
  return (
    DENIED_TOOL_NAMES.has(toolName) ||
    DENIED_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix))
  )
}

export function applyContainmentToolProfile<T extends ToolRegistry>(tools: T): T {
  for (const toolName of Object.keys(tools)) {
    if (isToolDeniedByContainmentProfile(toolName)) {
      delete tools[toolName]
    }
  }
  return tools
}
