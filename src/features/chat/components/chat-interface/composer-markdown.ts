export interface ComposerMarkdownSegment {
  markdown: string
  block: boolean
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
