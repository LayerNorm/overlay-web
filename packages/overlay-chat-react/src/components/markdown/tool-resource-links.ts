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
