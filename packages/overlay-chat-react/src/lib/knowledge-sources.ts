/**
 * Internal (knowledge) citations rendered through the same surfaces as web
 * sources: inline chips with a hover card, plus rows in the Sources panel.
 *
 * A knowledge source is a `WebSourceItem` with `origin: 'knowledge'` and an
 * `internalHref` in place of an external URL, so one list can carry both kinds
 * and every renderer branches in exactly one place.
 */
import type { SourceCitation, SourceCitationMap } from './source-citations'
import type { WebSourceItem } from './web-sources'

/** Canonical in-app destination for a cited file or memory. */
export function knowledgeSourceHref(citation: SourceCitation, appBaseUrl?: string | null): string {
  const base = (appBaseUrl ?? '').replace(/\/$/, '')
  // Memories live in Settings → Memories; `memory` selects and highlights one.
  return citation.kind === 'memory'
    ? `${base}/app/settings?section=memories&memory=${encodeURIComponent(citation.sourceId)}`
    : `${base}/app/files?file=${encodeURIComponent(citation.sourceId)}`
}

export function knowledgeSourceTitle(citation: SourceCitation): string {
  const title = citation.title?.trim()
  if (title && title.toLowerCase() !== 'memory') return title
  return citation.kind === 'memory' ? 'Memory' : 'File'
}

const CHIP_MEMORY_WORDS = 2
const CHIP_FILE_CHARS = 28

/**
 * Short label for an inline chip. A memory's full text is far too long to sit in
 * running prose, so it collapses to `Memory: first two words…`; the tooltip and
 * the sources panel still show the full title.
 */
export function knowledgeChipLabel(citation: SourceCitation): string {
  const title = knowledgeSourceTitle(citation)
  if (citation.kind !== 'memory') {
    return title.length > CHIP_FILE_CHARS ? `${title.slice(0, CHIP_FILE_CHARS - 1).trimEnd()}…` : title
  }
  if (title === 'Memory') return 'Memory'
  const words = title.split(/\s+/).filter(Boolean)
  const head = words.slice(0, CHIP_MEMORY_WORDS).join(' ')
  if (!head) return 'Memory'
  return words.length > CHIP_MEMORY_WORDS ? `Memory: ${head}…` : `Memory: ${head}`
}

/** Hash href for markdown chips (survives rehype-sanitize; React resolves the real route). */
export function knowledgeCitationMarkdownHref(indexOneBased: number): string {
  return `#overlay-knowcite-${indexOneBased}`
}

/** Ordered source list for the Sources button/panel, lowest citation number first. */
export function knowledgeSourcesFromCitations(
  citations: SourceCitationMap | undefined,
  appBaseUrl?: string | null,
): WebSourceItem[] {
  if (!citations) return []
  return Object.keys(citations)
    .map((key) => ({ key, index: Number(key) }))
    .filter((entry) => Number.isFinite(entry.index))
    .sort((a, b) => a.index - b.index)
    .map(({ key }) => {
      const citation = citations[key]!
      const href = knowledgeSourceHref(citation, appBaseUrl)
      return {
        url: href,
        internalHref: href,
        internalKind: citation.kind,
        title: knowledgeSourceTitle(citation),
        ...(citation.snippet?.trim() ? { snippet: citation.snippet.trim() } : {}),
        origin: 'knowledge' as const,
      }
    })
}

const KNOWLEDGE_HREF_PATTERNS: Array<{ re: RegExp; kind: 'file' | 'memory' }> = [
  // Current memory route, plus the legacy `/app/knowledge?memory=` links written
  // into older transcripts before memories moved under Settings.
  { re: /\/app\/settings\?section=memories&memory=([^)\s]+)/i, kind: 'memory' },
  { re: /\/app\/knowledge\?memory=([^)\s]+)/i, kind: 'memory' },
  { re: /\/app\/files\?file=([^)\s]+)/i, kind: 'file' },
  { re: /\/app\/knowledge\?file=([^)\s]+)/i, kind: 'file' },
]

/**
 * Recover citations from a persisted transcript. Older assistant messages have
 * the citation map baked into the markdown as a trailing `**Sources:** [1](…)`
 * line rather than carried in message metadata, so this is the only way to give
 * those chats the same sources UI as a live reply.
 */
export function knowledgeCitationsFromMarkdown(text: string): SourceCitationMap {
  const citations: SourceCitationMap = {}
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trimStart()
    if (trimmed === '') continue
    if (!/^(\*\*)?\s*(Sources|Citations|References)\s*:?/i.test(trimmed)) break
    for (const match of trimmed.matchAll(/\[\s*(\d+)\s*\]\(([^)]+)\)/g)) {
      const number = String(Number(match[1]))
      const href = match[2]!
      for (const { re, kind } of KNOWLEDGE_HREF_PATTERNS) {
        const hit = re.exec(href)
        if (!hit) continue
        citations[number] = { kind, sourceId: decodeURIComponent(hit[1]!) }
        break
      }
    }
    break
  }
  return citations
}

/**
 * External links that live only in a reply's trailing `Sources:` block. That
 * block is always stripped from the rendered markdown, so a turn whose sources
 * were never collected from a tool call would otherwise lose them entirely.
 */
export function externalSourcesFromMarkdown(text: string): WebSourceItem[] {
  const sources: WebSourceItem[] = []
  const seen = new Set<string>()
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trimStart()
    if (trimmed === '') continue
    if (!/^(\*\*)?\s*(Sources|Citations|References)\s*:?/i.test(trimmed)) break
    for (const match of trimmed.matchAll(/\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g)) {
      const url = match[2]!
      if (seen.has(url)) continue
      seen.add(url)
      sources.push({ url, title: match[1]?.trim() || '', origin: 'web-search' })
    }
    for (const match of trimmed.matchAll(/(?<!\]\()\bhttps?:\/\/[^\s)\]]+/g)) {
      const url = match[0]
      if (seen.has(url)) continue
      seen.add(url)
      sources.push({ url, title: '', origin: 'web-search' })
    }
    break
  }
  return sources
}

function transformOutsideCodeFences(text: string, fn: (chunk: string) => string): string {
  const fenceRe = /```[\s\S]*?```/g
  let last = 0
  let out = ''
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(text)) !== null) {
    out += fn(text.slice(last, m.index))
    out += m[0]
    last = m.index + m[0].length
  }
  out += fn(text.slice(last))
  return out
}

/**
 * Turn body-text `[n]` markers that resolve to a knowledge citation into chip
 * links. The trailing `Sources:` block is stripped separately — the Sources
 * button and panel carry that list now.
 */
export function linkifyInlineKnowledgeCitations(
  text: string,
  citations: SourceCitationMap,
): string {
  if (!citations || Object.keys(citations).length === 0) return text
  return transformOutsideCodeFences(text, (chunk) =>
    chunk.replace(/\[\s*(\d+)\s*\](?!\()/g, (full, digit: string) => {
      const citation = citations[String(Number(digit))]
      if (!citation) return full
      return `[${knowledgeChipLabel(citation)}](${knowledgeCitationMarkdownHref(Number(digit))})`
    }),
  )
}
