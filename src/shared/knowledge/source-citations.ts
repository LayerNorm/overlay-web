import type { SourceCitationMap } from './ask-knowledge-types'

/**
 * Link source numbers on a Sources line to their durable Overlay destination.
 *
 * The citation map itself is not persisted with the message, so the label rides
 * along in the markdown link title. Without it a reloaded transcript can only
 * say "File" or "Memory" — the chips and the sources panel would lose the names
 * they showed while the reply was live. The whole line is stripped from the
 * rendered markdown, so the extra title is never displayed as prose.
 */
export function linkifySourceCitationsMarkdown(
  text: string,
  citations: SourceCitationMap,
): string {
  if (!citations || Object.keys(citations).length === 0) return text
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart()
      if (!/^(\*\*)?Sources:(\*\*)?/i.test(trimmed)) return line
      return line.replace(/\[\s*(\d+)\s*\](?!\()/g, (_match, digit: string) => {
        const key = String(Number(digit))
        const source = citations[key]
        if (!source) return `[${digit}]`
        const href = source.kind === 'memory'
          ? `/app/settings?section=memories&memory=${encodeURIComponent(source.sourceId)}`
          : `/app/files?file=${encodeURIComponent(source.sourceId)}`
        const label = source.title?.trim().replace(/["\\]/g, '').replace(/\s+/g, ' ')
        return label ? `[${digit}](${href} "${label}")` : `[${digit}](${href})`
      })
    })
    .join('\n')
}
