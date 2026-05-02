/** Human-readable labels for assistant tool rows (aligned with landing ChatInterface). */

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

export function getDescriptiveToolLabel(toolName: string, toolInput?: Record<string, unknown>): string {
  const map: Record<string, string> = {
    browser_run_task: 'Browsing the web',
    interactive_browser_session: 'Browsing the web',
    perplexity_search: 'Searching the web',
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
  }
  if (map[toolName]) return map[toolName]!

  if (toolName === 'perplexity_search' && toolInput) {
    const q = pickFirstStringFromInput(toolInput, ['query', 'q'])
    if (q) {
      const clipped = q.length > 72 ? `${q.slice(0, 72)}…` : q
      return `Searching the web for “${clipped}”`
    }
  }

  return titleCaseUnderscore(toolName)
}
