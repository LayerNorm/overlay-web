export interface ComposerMarkdownSegment {
  markdown: string
  block: boolean
}

function safeComposerLinkHref(rawHref: string): string | null {
  try {
    const url = new URL(rawHref)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/([\\\[\]])/g, '\\$1')
}

/**
 * Preserve an anchor's destination when the contenteditable exposes only its
 * shortened visible label. Returning Markdown keeps the copied/sent payload
 * portable while the composer and transcript remain free to truncate display.
 */
export function composerAnchorToMarkdown(label: string, rawHref: string): string {
  const href = safeComposerLinkHref(rawHref)
  const visibleLabel = label.trim()
  if (!href) return visibleLabel
  if (!visibleLabel || visibleLabel === rawHref || visibleLabel === href) return href
  return `[${escapeMarkdownLinkLabel(visibleLabel)}](<${href.replace(/>/g, '%3E')}>)`
}

/** Join contenteditable root nodes without turning adjacent inline chips into paragraphs. */
export function joinComposerMarkdownSegments(segments: readonly ComposerMarkdownSegment[]): string {
  let markdown = ''
  for (const segment of segments) {
    if (segment.block && markdown && !markdown.endsWith('\n')) markdown += '\n'
    markdown += segment.markdown
    if (segment.block && !markdown.endsWith('\n')) markdown += '\n'
  }
  return markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u00A0/g, ' ')
    .replace(/\u200B/g, '')
    .trimEnd()
}
