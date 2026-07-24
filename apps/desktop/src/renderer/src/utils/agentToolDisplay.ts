function normalizeToolName(tool: string): string {
  return tool.trim()
}

function str(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined
}

function num(val: unknown): number | undefined {
  return typeof val === 'number' ? val : undefined
}

function shorten(text: string, max = 40): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

function extractFromResult(toolResult?: string): Record<string, unknown> | null {
  if (!toolResult) return null
  try {
    return JSON.parse(toolResult) as Record<string, unknown>
  } catch {
    return null
  }
}

function basename(path: string): string {
  return path.split('/').pop() || path
}

export function getAgentToolDisplayText(
  tool: string,
  isLoading: boolean,
  toolInput?: Record<string, unknown>,
  toolResult?: string
): string {
  const t = normalizeToolName(tool)
  const result = extractFromResult(toolResult)

  // ── Composio ────────────────────────────────────────────────────────────────
  if (t === 'COMPOSIO_SEARCH_TOOLS') {
    const q = str(toolInput?.query)
    if (q)
      return isLoading
        ? `searching tools for "${shorten(q)}"...`
        : `found tools for "${shorten(q)}"`
    return isLoading ? 'searching tools...' : 'searched tools'
  }
  if (t === 'COMPOSIO_MULTI_EXECUTE_TOOL')
    return isLoading ? 'executing tools...' : 'executed tools'
  if (t === 'COMPOSIO_MANAGE_CONNECTIONS')
    return isLoading ? 'checking integrations...' : 'checked integrations'
  if (t === 'COMPOSIO_GET_TOOL_SCHEMAS')
    return isLoading ? 'loading tool schemas...' : 'loaded tool schemas'
  if (t === 'COMPOSIO_REMOTE_BASH_TOOL')
    return isLoading ? 'running remote command...' : 'ran remote command'
  if (t === 'COMPOSIO_REMOTE_WORKBENCH')
    return isLoading ? 'running remote task...' : 'ran remote task'
  if (t === 'composio_execute') {
    const toolName = str(toolInput?.tool_name)
    if (toolName)
      return isLoading ? `executing ${shorten(toolName)}...` : `executed ${shorten(toolName)}`
    return isLoading ? 'executing integration...' : 'executed integration'
  }

  // ── Browser ─────────────────────────────────────────────────────────────────
  if (t === 'open_browser_url' || t === 'navigate_browser') {
    const url = str(toolInput?.url)
    if (url) {
      const domain = url.replace(/^https?:\/\//, '').split('/')[0]
      return isLoading ? `navigating to ${domain}...` : `navigated to ${domain}`
    }
    return isLoading ? 'navigating...' : 'navigated'
  }
  if (t === 'browser_get_page_content')
    return isLoading ? 'reading page content...' : 'read page content'
  if (t === 'browser_click') {
    const target = str(toolInput?.target)
    if (target)
      return isLoading ? `clicking "${shorten(target, 30)}"...` : `clicked "${shorten(target, 30)}"`
    return isLoading ? 'clicking element...' : 'clicked element'
  }
  if (t === 'browser_type') {
    const text = str(toolInput?.text)
    if (text) return isLoading ? `typing "${shorten(text, 30)}"...` : `typed "${shorten(text, 30)}"`
    return isLoading ? 'typing text...' : 'typed text'
  }
  if (t === 'browser_scroll') {
    const dir = str(toolInput?.direction)
    return isLoading ? `scrolling ${dir || 'page'}...` : `scrolled ${dir || 'page'}`
  }
  if (t === 'browser_wait') {
    const ms = num(toolInput?.ms)
    if (ms) return isLoading ? `waiting ${ms}ms...` : `waited ${ms}ms`
    return isLoading ? 'waiting...' : 'waited'
  }
  if (t === 'browser_select') return isLoading ? 'selecting option...' : 'selected option'
  if (t === 'browser_hover') return isLoading ? 'hovering element...' : 'hovered element'
  if (t === 'browser_execute_js') return isLoading ? 'running JavaScript...' : 'ran JavaScript'
  if (t === 'browser_go_back') return isLoading ? 'going back...' : 'went back'
  if (t === 'browser_go_forward') return isLoading ? 'going forward...' : 'went forward'
  if (t === 'browser_new_tab') return isLoading ? 'opening new tab...' : 'opened new tab'
  if (t === 'browser_close_tab') return isLoading ? 'closing tab...' : 'closed tab'
  if (t === 'browser_screenshot')
    return isLoading ? 'capturing screenshot...' : 'captured screenshot'
  if (t === 'search_web') {
    const q = str(toolInput?.query)
    if (q) return isLoading ? `searching "${shorten(q, 30)}"...` : `searched "${shorten(q, 30)}"`
    return isLoading ? 'searching web...' : 'searched web'
  }
  if (t === 'fetch_url_content') {
    const url = str(toolInput?.url)
    if (url) {
      const domain = url.replace(/^https?:\/\//, '').split('/')[0]
      return isLoading ? `fetching ${domain}...` : `fetched ${domain}`
    }
    return isLoading ? 'fetching URL content...' : 'fetched URL content'
  }
  if (t === 'web_search_tool') {
    const q = str(toolInput?.query)
    if (q) return isLoading ? `searching "${shorten(q, 30)}"...` : `searched "${shorten(q, 30)}"`
    return isLoading ? 'searching web...' : 'searched web'
  }

  // ── Core ────────────────────────────────────────────────────────────────────
  if (t === 'memory_search') {
    const q = str(toolInput?.query)
    if (q)
      return isLoading
        ? `searching memory for "${shorten(q, 25)}"...`
        : `searched memory for "${shorten(q, 25)}"`
    return isLoading ? 'searching memory...' : 'searched memory'
  }
  if (t === 'memory_add') {
    const content = str(toolInput?.content)
    if (content)
      return isLoading
        ? `saving "${shorten(content, 30)}" to memory...`
        : `saved "${shorten(content, 30)}" to memory`
    return isLoading ? 'saving to memory...' : 'saved to memory'
  }
  if (t === 'overlay_notes_search') {
    const q = str(toolInput?.query)
    if (q)
      return isLoading
        ? `searching notes for "${shorten(q, 25)}"...`
        : `searched notes for "${shorten(q, 25)}"`
    return isLoading ? 'searching notes...' : 'searched notes'
  }
  if (t === 'get_current_time') return isLoading ? 'checking time...' : 'checked time'
  if (t === 'request_user_input') {
    const reason = str(toolInput?.reason)
    if (reason)
      return isLoading
        ? `waiting: ${shorten(reason, 35)}...`
        : `user completed: ${shorten(reason, 35)}`
    return isLoading ? 'waiting for user input...' : 'user input received'
  }

  // ── OS / macOS ──────────────────────────────────────────────────────────────
  if (t === 'launch_app') {
    const appName = str(toolInput?.app_name)
    if (appName) return isLoading ? `launching ${appName}...` : `launched ${appName}`
    return isLoading ? 'launching app...' : 'launched app'
  }
  if (t === 'search_apps') {
    const q = str(toolInput?.query)
    if (q) return isLoading ? `searching apps for "${q}"...` : `found apps for "${q}"`
    return isLoading ? 'searching apps...' : 'searched apps'
  }
  if (t === 'applescript_run') {
    const intent = str(toolInput?.intent)
    if (intent)
      return isLoading ? `running: ${shorten(intent, 35)}...` : `ran: ${shorten(intent, 35)}`
    return isLoading ? 'running AppleScript...' : 'ran AppleScript'
  }
  if (t === 'contacts_search') {
    const name = str(toolInput?.name)
    if (name)
      return isLoading ? `searching contacts for "${name}"...` : `found contacts for "${name}"`
    return isLoading ? 'searching contacts...' : 'searched contacts'
  }
  if (t === 'imessage_send') {
    const recipient = str(toolInput?.recipient)
    if (recipient)
      return isLoading
        ? `sending message to ${shorten(recipient, 20)}...`
        : `sent message to ${shorten(recipient, 20)}`
    return isLoading ? 'sending iMessage...' : 'sent iMessage'
  }
  if (t === 'reminders_create') {
    const title = str(toolInput?.title)
    if (title)
      return isLoading
        ? `creating reminder "${shorten(title, 30)}"...`
        : `created reminder "${shorten(title, 30)}"`
    return isLoading ? 'creating reminder...' : 'created reminder'
  }
  if (t === 'reminders_list') {
    const list = str(toolInput?.list_name)
    if (list)
      return isLoading ? `listing reminders in "${list}"...` : `listed reminders in "${list}"`
    return isLoading ? 'listing reminders...' : 'listed reminders'
  }
  if (t === 'timer_set') {
    const mins = num(toolInput?.duration_minutes)
    const label = str(toolInput?.label)
    if (mins && label)
      return isLoading
        ? `setting ${mins}m timer: ${shorten(label, 25)}...`
        : `set ${mins}m timer: ${shorten(label, 25)}`
    if (mins) return isLoading ? `setting ${mins}m timer...` : `set ${mins}m timer`
    return isLoading ? 'setting timer...' : 'set timer'
  }
  if (t === 'ax_list_apps') return isLoading ? 'listing running apps...' : 'listed running apps'
  if (t === 'ax_get_ui_tree') return isLoading ? 'reading UI tree...' : 'read UI tree'
  if (t === 'ax_click') {
    const title = str(toolInput?.title)
    if (title)
      return isLoading ? `clicking "${shorten(title, 30)}"...` : `clicked "${shorten(title, 30)}"`
    return isLoading ? 'clicking UI element...' : 'clicked UI element'
  }
  if (t === 'download_file') {
    const url = str(toolInput?.url)
    if (url) {
      const filename = url.split('/').pop()?.split('?')[0] || 'file'
      return isLoading
        ? `downloading ${shorten(filename, 30)}...`
        : `downloaded ${shorten(filename, 30)}`
    }
    return isLoading ? 'downloading file...' : 'downloaded file'
  }
  if (t === 'shortcuts_list') return isLoading ? 'listing shortcuts...' : 'listed shortcuts'
  if (t === 'shortcuts_run') {
    const name = str(toolInput?.name_or_id)
    if (name)
      return isLoading
        ? `running shortcut "${shorten(name, 25)}"...`
        : `ran shortcut "${shorten(name, 25)}"`
    return isLoading ? 'running shortcut...' : 'ran shortcut'
  }
  if (t === 'shortcuts_view') {
    const name = str(toolInput?.name)
    if (name) return isLoading ? `opening shortcut "${name}"...` : `opened shortcut "${name}"`
    return isLoading ? 'opening shortcut...' : 'opened shortcut'
  }

  // ── Terminal ────────────────────────────────────────────────────────────────
  if (t === 'terminal_run') {
    const cmd = str(toolInput?.command)
    if (cmd) {
      const short = shorten(cmd, 40)
      if (!isLoading && result) {
        const exitCode = num(result.exitCode)
        if (exitCode !== undefined && exitCode !== 0)
          return `\`${short}\` failed (exit ${exitCode})`
        if (result.timedOut) return `\`${short}\` timed out`
      }
      return isLoading ? `running \`${short}\`...` : `ran \`${short}\``
    }
    return isLoading ? 'running command...' : 'ran command'
  }
  if (t === 'terminal_session_start') {
    const cwd = str(toolInput?.cwd)
    if (cwd)
      return isLoading
        ? `starting terminal in ${basename(cwd)}...`
        : `started terminal in ${basename(cwd)}`
    return isLoading ? 'starting terminal session...' : 'started terminal session'
  }
  if (t === 'terminal_session_write') {
    const input = str(toolInput?.input)
    if (input) {
      const clean = input.replace(/\n$/, '')
      return isLoading ? `sending \`${shorten(clean, 30)}\`...` : `sent \`${shorten(clean, 30)}\``
    }
    return isLoading ? 'writing to terminal...' : 'wrote to terminal'
  }
  if (t === 'terminal_session_read')
    return isLoading ? 'reading terminal output...' : 'read terminal output'
  if (t === 'terminal_session_kill')
    return isLoading ? 'killing terminal session...' : 'killed terminal session'
  if (t === 'terminal_list_sessions') {
    if (!isLoading && result) {
      const count = num(result.count)
      if (count !== undefined) return `found ${count} active session${count !== 1 ? 's' : ''}`
    }
    return isLoading ? 'listing terminal sessions...' : 'listed terminal sessions'
  }

  // ── File System ─────────────────────────────────────────────────────────────
  if (t === 'fs_read_file') {
    const path = str(toolInput?.path)
    if (path) return isLoading ? `reading ${basename(path)}...` : `read ${basename(path)}`
    return isLoading ? 'reading file...' : 'read file'
  }
  if (t === 'fs_write_file') {
    const path = str(toolInput?.path)
    if (path) {
      if (!isLoading && result) {
        const bytes = num(result.bytes)
        if (bytes !== undefined) return `wrote ${basename(path)} (${bytes} bytes)`
      }
      return isLoading ? `writing ${basename(path)}...` : `wrote ${basename(path)}`
    }
    return isLoading ? 'writing file...' : 'wrote file'
  }
  if (t === 'fs_list_dir') {
    const path = str(toolInput?.path)
    if (!isLoading && result) {
      const count = num(result.count)
      if (count !== undefined)
        return `listed ${count} items in ${path ? basename(path) : 'directory'}`
    }
    if (path) return isLoading ? `listing ${basename(path)}/...` : `listed ${basename(path)}/`
    return isLoading ? 'listing directory...' : 'listed directory'
  }
  if (t === 'fs_search_files') {
    const pattern = str(toolInput?.pattern)
    if (!isLoading && result) {
      const count = num(result.count)
      if (count !== undefined && pattern)
        return `found ${count} file${count !== 1 ? 's' : ''} matching "${pattern}"`
    }
    if (pattern) return isLoading ? `searching for "${pattern}"...` : `searched for "${pattern}"`
    return isLoading ? 'searching files...' : 'searched files'
  }
  if (t === 'fs_move') {
    const src = str(toolInput?.source)
    const dest = str(toolInput?.destination)
    if (src && dest)
      return isLoading
        ? `moving ${basename(src)} → ${basename(dest)}...`
        : `moved ${basename(src)} → ${basename(dest)}`
    return isLoading ? 'moving file...' : 'moved file'
  }
  if (t === 'fs_copy') {
    const src = str(toolInput?.source)
    const dest = str(toolInput?.destination)
    if (src && dest)
      return isLoading
        ? `copying ${basename(src)} → ${basename(dest)}...`
        : `copied ${basename(src)} → ${basename(dest)}`
    return isLoading ? 'copying file...' : 'copied file'
  }
  if (t === 'fs_delete') {
    const path = str(toolInput?.path)
    if (path) return isLoading ? `deleting ${basename(path)}...` : `deleted ${basename(path)}`
    return isLoading ? 'deleting...' : 'deleted'
  }
  if (t === 'fs_info') {
    const path = str(toolInput?.path)
    if (path) return isLoading ? `inspecting ${basename(path)}...` : `inspected ${basename(path)}`
    return isLoading ? 'getting file info...' : 'got file info'
  }

  // ── Notebook ────────────────────────────────────────────────────────────────
  if (t === 'read_note') return isLoading ? 'reading note...' : 'read note'
  if (t === 'propose_edit') return isLoading ? 'proposing edit...' : 'proposed edit'
  if (t === 'finish') {
    const summary = str(toolInput?.summary)
    if (summary) return `done: ${shorten(summary, 40)}`
    return isLoading ? 'finishing...' : 'finished'
  }

  // ── Script / Runtime ───────────────────────────────────────────────────────
  if (t === 'script_run') {
    const lang = str(toolInput?.runtime) || str(toolInput?.language)
    const label = lang === 'javascript' ? 'JS' : lang === 'python' ? 'Python' : lang || 'script'
    if (!isLoading && result) {
      const exitCode = num(result.exitCode)
      if (exitCode !== undefined && exitCode !== 0)
        return `${label} script failed (exit ${exitCode})`
      if (result.timedOut) return `${label} script timed out`
    }
    return isLoading ? `running ${label} script...` : `ran ${label} script`
  }
  if (t === 'install_packages') {
    const pkgs = toolInput?.packages
    const pkgList = Array.isArray(pkgs) ? pkgs.join(', ') : str(pkgs)
    if (pkgList) return isLoading ? `installing ${shorten(pkgList, 30)}...` : `installed ${shorten(pkgList, 30)}`
    return isLoading ? 'installing packages...' : 'installed packages'
  }

  // ── Completion ──────────────────────────────────────────────────────────────
  if (t === 'done') {
    const summary = str(toolInput?.summary)
    if (summary) return `done: ${shorten(summary, 40)}`
    return isLoading ? 'completing task...' : 'completed task'
  }
  if (t === 'task_complete') return isLoading ? 'completing task...' : 'completed task'

  // ── Fallback: try to generate readable text from tool name ──────────────────
  const readable = t
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return isLoading ? `${readable}...` : readable
}
