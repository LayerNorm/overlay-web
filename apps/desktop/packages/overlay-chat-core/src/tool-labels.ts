import { INTEGRATION_SERVICE_NAMES } from './constants'

export function pickFirstStringFromInput(input: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!input) return null
  for (const k of keys) {
    const v = input[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

export function titleCaseUnderscore(id: string): string {
  return id
    .trim()
    .split(/_+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

function describeComposioSearchToolsInput(input?: Record<string, unknown>): string | null {
  if (!input) return null
  const hint =
    pickFirstStringFromInput(input, ['use_case', 'intent', 'description', 'goal', 'task']) ??
    (typeof input.query === 'string' ? input.query : null)
  if (hint) {
    const clipped = hint.length > 120 ? `${hint.slice(0, 120)}…` : hint
    return `Finding the right tools — ${clipped}`
  }
  const qs = input.queries
  if (Array.isArray(qs) && qs.length && typeof qs[0] === 'string' && qs[0].trim()) {
    const q = qs[0]!.trim()
    const clipped = q.length > 80 ? `${q.slice(0, 80)}…` : q
    return `Searching apps for “${clipped}”`
  }
  return null
}

function serviceNameFromComposioTool(toolName: string): string | null {
  const u = toolName.toUpperCase()
  const keys = Object.keys(INTEGRATION_SERVICE_NAMES).sort((a, b) => b.length - a.length)
  for (const prefix of keys) {
    if (u.startsWith(`${prefix}_`)) {
      return INTEGRATION_SERVICE_NAMES[prefix] ?? null
    }
  }
  return null
}

function describeComposioIntegrationTool(toolName: string, input?: Record<string, unknown>): string {
  const service = serviceNameFromComposioTool(toolName)
  const u = toolName.toUpperCase()
  const q =
    input &&
    pickFirstStringFromInput(input, [
      'query',
      'search_query',
      'q',
      'search',
      'prompt',
      'message',
      'subject',
      'body',
      'text',
    ])

  if (service) {
    if (q && (u.includes('SEARCH') || u.includes('FIND') || u.includes('QUERY') || u.includes('LIST_MESSAGE'))) {
      const clipped = q.length > 56 ? `${q.slice(0, 56)}…` : q
      return `Searching ${service} for “${clipped}”`
    }
    if (/(SEND|POST|CREATE_MESSAGE|REPLY)/.test(u) && u.includes('MAIL')) {
      return `Sending mail in ${service}`
    }
    if (/(SEND|POST|MESSAGE)/.test(u) && u.includes('SLACK')) {
      return `Sending a message in ${service}`
    }
    if (/(CREATE_EVENT|ADD_EVENT|INSERT_EVENT|SCHEDULE)/.test(u)) {
      return `Scheduling an event in ${service}`
    }
    if (/(LIST_MESSAGES|FETCH|INBOX|THREAD)/.test(u) && u.includes('GMAIL')) {
      return `Reading mail in ${service}`
    }
    if (/(LIST_EVENT|GET_EVENT|SEARCH_EVENT|FIND_EVENT|FREE_BUSY|AVAILABILITY)/.test(u)) {
      return `Looking at events in ${service}`
    }
    if (/(UPDATE_EVENT|PATCH_EVENT|EDIT_EVENT)/.test(u)) {
      return `Updating an event in ${service}`
    }
    if (/(DELETE_EVENT|REMOVE|CANCEL_EVENT)/.test(u)) {
      return `Updating calendar in ${service}`
    }
    if (/(CREATE|ADD|NEW)/.test(u) && !/(CREATE_EVENT)/.test(u)) {
      return `Creating in ${service}`
    }
    if (/(UPDATE|EDIT|PATCH)/.test(u)) {
      return `Updating ${service}`
    }
    if (/(DELETE|REMOVE)/.test(u)) {
      return `Deleting in ${service}`
    }
    if (/(LIST|SEARCH|FETCH|GET|FIND|QUERY|READ)/.test(u)) {
      return `Searching ${service}`
    }
    return `Using ${service}`
  }

  if (u.includes('MULTI_EXECUTE')) {
    return 'Running connected app actions'
  }
  if (u.includes('SEARCH_TOOLS')) {
    return describeComposioSearchToolsInput(input) ?? 'Finding the right tools for your task'
  }

  return titleCaseUnderscore(toolName.replace(/^composio_/i, ''))
}

export function getDescriptiveToolLabel(toolName: string, toolInput?: Record<string, unknown>): string {
  const map: Record<string, string> = {
    browser_run_task: 'Browsing the web',
    interactive_browser_session: 'Browsing the web',
    perplexity_search: 'Searching the web',
    parallel_search: 'Deep web research',
    search_knowledge: 'Searching your knowledge',
    list_skills: 'Checking your skills',
    list_notes: 'Listing your notes',
    get_note: 'Opening a note',
    create_note: 'Creating a note',
    update_note: 'Updating a note',
    delete_note: 'Deleting a note',
    save_memory: 'Saving to memory',
    update_memory: 'Updating memory',
    delete_memory: 'Deleting memory',
    generate_image: 'Generating an image',
    generate_video: 'Generating a video',
    run_daytona_sandbox: 'Running your workspace',
    search_mcp_tools: 'Searching MCP integrations',
    call_mcp_tool: 'Calling MCP tool',
  }
  if (map[toolName]) return map[toolName]!

  if (toolName === 'COMPOSIO_SEARCH_TOOLS') {
    return describeComposioSearchToolsInput(toolInput) ?? 'Finding the right tools for your task'
  }

  if (/composio|GMAIL_|GOOGLE_|SLACK_|NOTION_|GITHUB_|LINEAR_|OUTLOOK_|CAL_COM/i.test(toolName)) {
    return describeComposioIntegrationTool(toolName, toolInput)
  }

  if (toolName === 'perplexity_search' && toolInput) {
    const q = pickFirstStringFromInput(toolInput, ['query', 'q'])
    if (q) {
      const clipped = q.length > 72 ? `${q.slice(0, 72)}…` : q
      return `Searching the web for “${clipped}”`
    }
  }

  if (toolName === 'parallel_search' && toolInput) {
    const o = pickFirstStringFromInput(toolInput, ['objective'])
    if (o) {
      const clipped = o.length > 72 ? `${o.slice(0, 72)}…` : o
      return `Researching: “${clipped}”`
    }
  }

  if (toolName === 'call_mcp_tool' && toolInput) {
    const toolNameArg = pickFirstStringFromInput(toolInput, ['toolName'])
    if (toolNameArg) {
      const clipped = toolNameArg.length > 48 ? `${toolNameArg.slice(0, 48)}…` : toolNameArg
      return `MCP: ${clipped}`
    }
  }

  if (toolName === 'search_mcp_tools' && toolInput) {
    const q = pickFirstStringFromInput(toolInput, ['query'])
    if (q) {
      const clipped = q.length > 56 ? `${q.slice(0, 56)}…` : q
      return `Searching MCP for “${clipped}”`
    }
  }

  if (toolName.startsWith('mcp_')) {
    const rest = toolName.slice(4)
    const firstUnderscore = rest.indexOf('_')
    if (firstUnderscore > 0) {
      const serverSlug = rest.slice(0, firstUnderscore)
      const toolSlug = rest.slice(firstUnderscore + 1)
      const serverName = titleCaseUnderscore(serverSlug)
      const toolDisplayName = titleCaseUnderscore(toolSlug)
      return `${serverName} MCP: ${toolDisplayName}`
    }
  }

  return titleCaseUnderscore(toolName)
}
