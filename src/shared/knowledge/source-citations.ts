import type { SourceCitationMap } from './ask-knowledge-types'

/** Link source numbers on a Sources line to their durable Overlay destination. */
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
          : source.kind === 'knowledge'
            ? `/app/knowledge/${encodeURIComponent(source.knowledgeBaseId)}?source=${encodeURIComponent(source.sourceId)}`
            : `/app/files?file=${encodeURIComponent(source.sourceId)}`
        return `[${digit}](${href})`
      })
    })
    .join('\n')
}
