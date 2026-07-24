export const AGENT_SURFACES = ['chat', 'browser', 'notebook', 'voice'] as const
export type AgentSurface = (typeof AGENT_SURFACES)[number]

export const TOOL_SECURITY_CLASSES = [
  'pure',
  'sensitive_read',
  'filesystem_read',
  'filesystem_write',
  'process_execution',
  'package_installation',
  'network_read',
  'browser_read',
  'browser_mutation',
  'os_automation',
  'integration_read',
  'integration_mutation',
  'destructive'
] as const
export type ToolSecurityClass = (typeof TOOL_SECURITY_CLASSES)[number]

export const EXECUTION_TARGETS = [
  'main_pure',
  'canonical_server',
  'host_process',
  'microvm',
  'host_broker',
  'agent_browser'
] as const
export type ExecutionTarget = (typeof EXECUTION_TARGETS)[number]

export const APPROVAL_POLICIES = ['none', 'task_grant', 'contextual'] as const
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number]

export const AGENT_CAPABILITIES = [
  'memory_read',
  'memory_write',
  'network_read',
  'browser_read',
  'browser_mutation',
  'os_automation',
  'terminal',
  'filesystem_read',
  'filesystem_write',
  'runtime_execution',
  'package_installation',
  'integration_read',
  'integration_mutation',
  'coding'
] as const
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number]

export interface ToolRegistration {
  readonly name: string
  readonly securityClass: ToolSecurityClass
  readonly executionTarget: ExecutionTarget
  readonly approval: ApprovalPolicy
  readonly capability?: AgentCapability
  readonly requiresAuthentication: boolean
  readonly allowedSurfaces: readonly AgentSurface[]
  readonly dataEgress: 'none' | 'overlay_server' | 'public_network' | 'integration'
}

const ALL_SURFACES = AGENT_SURFACES
const CHAT_BROWSER_VOICE = ['chat', 'browser', 'voice'] as const
const BROWSER_ONLY = ['browser'] as const
const NOTEBOOK_ONLY = ['notebook'] as const

function registration(
  name: string,
  securityClass: ToolSecurityClass,
  executionTarget: ExecutionTarget,
  options: {
    approval?: ApprovalPolicy
    capability?: AgentCapability
    requiresAuthentication?: boolean
    allowedSurfaces?: readonly AgentSurface[]
    dataEgress?: ToolRegistration['dataEgress']
  } = {}
): ToolRegistration {
  return Object.freeze({
    name,
    securityClass,
    executionTarget,
    approval: options.approval ?? 'none',
    ...(options.capability ? { capability: options.capability } : {}),
    requiresAuthentication: options.requiresAuthentication ?? true,
    allowedSurfaces: Object.freeze([...(options.allowedSurfaces ?? ALL_SURFACES)]),
    dataEgress: options.dataEgress ?? 'none'
  })
}

const STATIC_TOOL_REGISTRATIONS = [
  registration('get_current_time', 'pure', 'main_pure', {
    requiresAuthentication: false
  }),
  registration('request_user_input', 'pure', 'main_pure'),
  registration('done', 'pure', 'main_pure', { allowedSurfaces: ['chat'] }),
  registration('task_complete', 'pure', 'main_pure', {
    allowedSurfaces: ['browser', 'voice']
  }),
  registration('finish', 'pure', 'main_pure', { allowedSurfaces: NOTEBOOK_ONLY }),
  registration('read_note', 'sensitive_read', 'main_pure', {
    allowedSurfaces: NOTEBOOK_ONLY
  }),
  registration('propose_edit', 'pure', 'main_pure', {
    allowedSurfaces: NOTEBOOK_ONLY
  }),

  registration('memory_search', 'sensitive_read', 'canonical_server', {
    capability: 'memory_read',
    dataEgress: 'overlay_server'
  }),
  registration('memory_add', 'integration_mutation', 'canonical_server', {
    approval: 'task_grant',
    capability: 'memory_write',
    dataEgress: 'overlay_server'
  }),
  registration('overlay_notes_search', 'sensitive_read', 'canonical_server', {
    capability: 'memory_read',
    dataEgress: 'overlay_server'
  }),
  registration('web_search_tool', 'network_read', 'canonical_server', {
    capability: 'network_read',
    dataEgress: 'overlay_server'
  }),

  registration('fetch_url_content', 'network_read', 'agent_browser', {
    approval: 'task_grant',
    capability: 'network_read',
    allowedSurfaces: CHAT_BROWSER_VOICE,
    dataEgress: 'public_network'
  }),
  registration('search_web', 'network_read', 'agent_browser', {
    approval: 'task_grant',
    capability: 'network_read',
    allowedSurfaces: CHAT_BROWSER_VOICE,
    dataEgress: 'public_network'
  }),
  registration('open_browser_url', 'browser_mutation', 'agent_browser', {
    approval: 'contextual',
    capability: 'browser_mutation',
    allowedSurfaces: CHAT_BROWSER_VOICE,
    dataEgress: 'public_network'
  }),
  registration('navigate_browser', 'browser_mutation', 'agent_browser', {
    approval: 'contextual',
    capability: 'browser_mutation',
    allowedSurfaces: CHAT_BROWSER_VOICE,
    dataEgress: 'public_network'
  }),
  registration('browser_get_page_content', 'browser_read', 'agent_browser', {
    approval: 'task_grant',
    capability: 'browser_read',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('browser_screenshot', 'browser_read', 'agent_browser', {
    approval: 'task_grant',
    capability: 'browser_read',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('browser_wait', 'browser_read', 'agent_browser', {
    approval: 'task_grant',
    capability: 'browser_read',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('browser_scroll', 'browser_mutation', 'agent_browser', {
    approval: 'task_grant',
    capability: 'browser_mutation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('browser_click', 'browser_mutation', 'agent_browser', {
    approval: 'contextual',
    capability: 'browser_mutation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('browser_type', 'browser_mutation', 'agent_browser', {
    approval: 'contextual',
    capability: 'browser_mutation',
    allowedSurfaces: CHAT_BROWSER_VOICE,
    dataEgress: 'public_network'
  }),

  registration('headless_navigate', 'browser_mutation', 'agent_browser', {
    approval: 'contextual',
    capability: 'browser_mutation',
    allowedSurfaces: BROWSER_ONLY,
    dataEgress: 'public_network'
  }),
  registration('headless_get_page_content', 'browser_read', 'agent_browser', {
    approval: 'task_grant',
    capability: 'browser_read',
    allowedSurfaces: BROWSER_ONLY
  }),
  registration('headless_screenshot', 'browser_read', 'agent_browser', {
    approval: 'task_grant',
    capability: 'browser_read',
    allowedSurfaces: BROWSER_ONLY
  }),
  registration('headless_scroll', 'browser_mutation', 'agent_browser', {
    approval: 'task_grant',
    capability: 'browser_mutation',
    allowedSurfaces: BROWSER_ONLY
  }),
  registration('headless_click', 'browser_mutation', 'agent_browser', {
    approval: 'contextual',
    capability: 'browser_mutation',
    allowedSurfaces: BROWSER_ONLY
  }),
  registration('headless_type', 'browser_mutation', 'agent_browser', {
    approval: 'contextual',
    capability: 'browser_mutation',
    allowedSurfaces: BROWSER_ONLY,
    dataEgress: 'public_network'
  }),

  registration('search_apps', 'sensitive_read', 'host_process', {
    approval: 'task_grant',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('launch_app', 'os_automation', 'host_process', {
    approval: 'contextual',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('applescript_run', 'os_automation', 'host_process', {
    approval: 'contextual',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('contacts_search', 'sensitive_read', 'host_process', {
    approval: 'contextual',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('imessage_send', 'os_automation', 'host_process', {
    approval: 'contextual',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE,
    dataEgress: 'integration'
  }),
  registration('reminders_create', 'os_automation', 'host_process', {
    approval: 'contextual',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('reminders_list', 'sensitive_read', 'host_process', {
    approval: 'contextual',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('timer_set', 'os_automation', 'host_process', {
    approval: 'contextual',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('ax_list_apps', 'sensitive_read', 'host_process', {
    approval: 'task_grant',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('ax_get_ui_tree', 'sensitive_read', 'host_process', {
    approval: 'contextual',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('ax_click', 'os_automation', 'host_process', {
    approval: 'contextual',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('shortcuts_list', 'sensitive_read', 'host_process', {
    approval: 'task_grant',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('shortcuts_view', 'sensitive_read', 'host_process', {
    approval: 'contextual',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('shortcuts_run', 'os_automation', 'host_process', {
    approval: 'contextual',
    capability: 'os_automation',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('download_file', 'filesystem_write', 'host_process', {
    approval: 'contextual',
    capability: 'filesystem_write',
    allowedSurfaces: CHAT_BROWSER_VOICE,
    dataEgress: 'public_network'
  }),

  ...[
    'terminal_run',
    'terminal_session_start',
    'terminal_session_write',
    'terminal_session_read',
    'terminal_session_kill',
    'terminal_list_sessions'
  ].map((name) =>
    registration(name, 'process_execution', 'host_process', {
      approval: name.includes('read') || name.includes('list') ? 'task_grant' : 'contextual',
      capability: 'terminal',
      allowedSurfaces: CHAT_BROWSER_VOICE
    })
  ),

  registration('fs_read_file', 'filesystem_read', 'host_process', {
    approval: 'task_grant',
    capability: 'filesystem_read',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('fs_list_dir', 'filesystem_read', 'host_process', {
    approval: 'task_grant',
    capability: 'filesystem_read',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('fs_search_files', 'filesystem_read', 'host_process', {
    approval: 'task_grant',
    capability: 'filesystem_read',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('fs_info', 'filesystem_read', 'host_process', {
    approval: 'task_grant',
    capability: 'filesystem_read',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  ...['fs_write_file', 'fs_move', 'fs_copy'].map((name) =>
    registration(name, 'filesystem_write', 'host_process', {
      approval: 'contextual',
      capability: 'filesystem_write',
      allowedSurfaces: CHAT_BROWSER_VOICE
    })
  ),
  registration('fs_delete', 'destructive', 'host_process', {
    approval: 'contextual',
    capability: 'filesystem_write',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),

  registration('script_run', 'process_execution', 'host_process', {
    approval: 'contextual',
    capability: 'runtime_execution',
    allowedSurfaces: CHAT_BROWSER_VOICE
  }),
  registration('install_packages', 'package_installation', 'host_process', {
    approval: 'contextual',
    capability: 'package_installation',
    allowedSurfaces: CHAT_BROWSER_VOICE,
    dataEgress: 'public_network'
  }),

  registration('code_edit_file', 'filesystem_write', 'host_process', {
    approval: 'contextual',
    capability: 'coding',
    allowedSurfaces: ['chat']
  }),
  registration('code_search_codebase', 'filesystem_read', 'host_process', {
    approval: 'task_grant',
    capability: 'coding',
    allowedSurfaces: ['chat']
  }),
  registration('code_run_tests', 'process_execution', 'host_process', {
    approval: 'contextual',
    capability: 'coding',
    allowedSurfaces: ['chat']
  }),
  registration('code_git_status', 'filesystem_read', 'host_process', {
    approval: 'task_grant',
    capability: 'coding',
    allowedSurfaces: ['chat']
  }),
  registration('code_git_diff', 'filesystem_read', 'host_process', {
    approval: 'task_grant',
    capability: 'coding',
    allowedSurfaces: ['chat']
  }),
  registration('code_git_commit', 'filesystem_write', 'host_process', {
    approval: 'contextual',
    capability: 'coding',
    allowedSurfaces: ['chat']
  }),
  registration('code_lint', 'process_execution', 'host_process', {
    approval: 'contextual',
    capability: 'coding',
    allowedSurfaces: ['chat']
  }),

  registration('composio_execute', 'integration_mutation', 'host_process', {
    approval: 'contextual',
    capability: 'integration_mutation',
    allowedSurfaces: BROWSER_ONLY,
    dataEgress: 'integration'
  })
] satisfies readonly ToolRegistration[]

const registrations = new Map(
  STATIC_TOOL_REGISTRATIONS.map((entry) => [entry.name, entry] as const)
)

if (registrations.size !== STATIC_TOOL_REGISTRATIONS.length) {
  throw new Error('duplicate_agent_tool_registration')
}

const DYNAMIC_COMPOSIO_REGISTRATION = registration(
  'COMPOSIO_*',
  'integration_mutation',
  'host_process',
  {
    approval: 'contextual',
    capability: 'integration_mutation',
    dataEgress: 'integration'
  }
)

export function getToolRegistration(toolName: string): ToolRegistration | null {
  return (
    registrations.get(toolName) ??
    (toolName.startsWith('COMPOSIO_') ? { ...DYNAMIC_COMPOSIO_REGISTRATION, name: toolName } : null)
  )
}

export function listStaticToolRegistrations(): readonly ToolRegistration[] {
  return STATIC_TOOL_REGISTRATIONS
}

export function assertEveryToolIsRegistered(toolNames: readonly string[]): void {
  const missing = toolNames.filter((name) => !getToolRegistration(name))
  if (missing.length > 0) {
    throw new Error(`unregistered_agent_tools:${missing.sort().join(',')}`)
  }
}
