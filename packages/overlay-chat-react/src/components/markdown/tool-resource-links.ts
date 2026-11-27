import type { AssistantVisualBlock } from '@overlay/chat-core'
import { isFileContentHref } from './plugins'

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function isNoteHref(href: string): boolean {
  if (!href.startsWith('/app/')) return false
  const url = new URL(href, 'https://overlay.invalid')
  return /^\/app\/(?:w\/[^/]+\/)?notes$/.test(url.pathname)
    && href === `${url.pathname}${url.search}`
    && url.searchParams.size === 2
    && Boolean(url.searchParams.get('id'))
    && ['personal', 'workspace'].includes(url.searchParams.get('scope') ?? '')
}

export function collectToolResourceHrefs(blocks: AssistantVisualBlock[]): string[] {
  const hrefs = new Set<string>()
  for (const block of blocks) {
    if (block.kind !== 'tool' || block.state !== 'output-available') continue
    const output = record(block.toolOutput)
    if (output?.success !== true) continue
    if (block.name === 'create_note' || block.name === 'get_note') {
      const href = block.name === 'get_note' ? record(output.note)?.url : output.url
      if (typeof href === 'string' && isNoteHref(href)) hrefs.add(href)
    } else if (block.name === 'computer_publish_file') {
      const href = output.downloadUrl
      if (typeof href === 'string' && isFileContentHref(href)) hrefs.add(href)
    }
  }
  return [...hrefs]
}

export function resolveToolResourceHref(href: string, canonicalHrefs?: readonly string[]): string | undefined {
  if (!canonicalHrefs?.length || !/^https?:\/\//i.test(href)) return undefined
  try {
    const url = new URL(href)
    const relative = `${url.pathname}${url.search}${url.hash}`
    return canonicalHrefs.includes(relative) ? relative : undefined
  } catch {
    return undefined
  }
}

const CREATING_TOOLS = new Set(['write_file', 'create_note', 'generate_image', 'generate_video', 'animate_image', 'computer_publish_file', 'computer_recording', 'run_api', 'save_api_file'])
const FILE_CONTENT_URL = /\/api\/v1\/files\/([^/?#)\s"']+)\/content/g
const MARKDOWN_EMBED = /!\[[^\]]*\]\(\s*<?([^)\s>]+)/g

function createdFileIds(block: Extract<AssistantVisualBlock, { kind: 'tool' }>): string[] {
  const output = record(block.toolOutput)
  if (output?.success !== true || output.status === 'pending') return []
  // A rewrite of an existing file is an edit, not a new file to show.
  if (block.name === 'write_file' && typeof record(block.toolInput)?.fileId === 'string') return []
  // An API run can save several files (3D models, audio, documents) and its whole output when it is large.
  if (block.name === 'run_api') {
    const saved = [...(Array.isArray(output.files) ? output.files : []), output.fullOutputFile]
    return saved.map(file => record(file)?.fileId).filter((id): id is string => typeof id === 'string' && id.length > 0)
  }
  const id = output.fileId ?? output.noteId ?? output.outputId ?? record(output.artifact)?.fileId
  return typeof id === 'string' && id ? [id] : []
}

function decodedId(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

/**
 * Files a turn created that its text and media do not already embed, in creation order. The message renders these as
 * a card strip after its body, so a created file appears once: inline where the agent embedded it, here otherwise. A
 * plain text link to a file ("the video is [here](…)") does not count, so the card stays when the reply finishes.
 */
export function collectCreatedFileIds(blocks: AssistantVisualBlock[]): string[] {
  const shown = new Set<string>()
  const markShown = (source: string) => {
    for (const match of source.matchAll(FILE_CONTENT_URL)) {
      const id = decodedId(match[1]!)
      if (id) shown.add(id)
    }
  }
  for (const block of blocks) {
    if (block.kind === 'file') markShown(block.url)
    // Only an embed (`![name](url)`) shows the file; a plain link to it still leaves its card to the strip.
    else if (block.kind === 'text') for (const embed of block.text.matchAll(MARKDOWN_EMBED)) markShown(embed[1]!)
  }
  const created: string[] = []
  for (const block of blocks) {
    if (block.kind !== 'tool' || !CREATING_TOOLS.has(block.name) || block.state !== 'output-available') continue
    for (const id of createdFileIds(block)) {
      if (!shown.has(id) && !created.includes(id)) created.push(id)
    }
  }
  return created
}
