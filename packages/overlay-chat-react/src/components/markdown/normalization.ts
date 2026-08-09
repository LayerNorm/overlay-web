import { stripThinkingPlaceholderMarkdown } from '../../lib/agent-assistant-text'
import { mergeGfmTableContinuationLines } from '../../lib/markdown-table-fix'
import { normalizeAssistantMathMarkdown } from '../../lib/math-markdown-normalize'
import type { SourceCitationMap } from '../../lib/source-citations'
import { linkifyInlineWebCitations,type WebSourceItem } from '../../lib/web-sources'

const STREAM_MARKER_HTML = '<span class="overlay-stream-marker" aria-hidden="true"></span>'

/**
 * Append the streaming indicator span to `text` so it renders inline at the end
 * of the last token. If the last line is a structural marker (fence, math delim,
 * table row, horizontal rule), the span is placed on its own new line so we
 * don't break the preceding block’s parsing.
 */
export function appendStreamMarker(text: string): string {
  if (!text) return STREAM_MARKER_HTML
  const lastNewline = text.lastIndexOf('\n')
  const lastLine = lastNewline >= 0 ? text.slice(lastNewline + 1) : text
  const trimmed = lastLine.trim()
  const isStructural =
    trimmed === '' ||
    trimmed.startsWith('```') ||
    trimmed === '$$' ||
    trimmed.startsWith('|') ||
    /^[-*_]{3,}\s*$/.test(trimmed)
  if (isStructural) {
    const sep = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
    return text + sep + STREAM_MARKER_HTML
  }
  return text + STREAM_MARKER_HTML
}

function stripHtmlishToMarkdown(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<p>/gi, '')
    .replace(/<\/p>/gi, '')
    .replace(/<li>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/?(ul|ol)>/gi, '')
    .replace(/&nbsp;/gi, ' ')
}

/** Models often emit full-width lenticular brackets; normalize to ASCII for **Sources:** lines. */
function bracketNormalize(text: string): string {
  return text.replace(/【/g, '[').replace(/】/g, ']')
}

/**
 * Remove the trailing "Sources: …" prose block models emit at the end of web-search responses.
 * We surface sources via inline chips + the sources sidebar button, so the plaintext list is redundant.
 * Conservative: only strips when the block appears near the end of the message.
 */
function stripTrailingSourcesBlock(text: string): string {
  const lines = text.split('\n')
  // Find last non-empty line that starts a Sources: paragraph.
  let startIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trimStart()
    if (trimmed === '') continue
    if (/^(\*\*)?\s*(Sources|Citations|References)\s*:?/i.test(trimmed)) {
      startIdx = i
    }
    break
  }
  if (startIdx < 0) return text
  // Strip from the Sources: line through end-of-text (inclusive).
  const kept = lines.slice(0, startIdx)
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop()
  return kept.join('\n')
}

/** Turn `[n]` on **Sources:** lines into markdown links to Knowledge (when we have retrieval metadata). */
function linkifySourceCitations(text: string, citations: SourceCitationMap, appBaseUrl?: string | null): string {
  if (!citations || Object.keys(citations).length === 0) return text
  const lines = text.split('\n')
  return lines
    .map((line) => {
      const trimmed = line.trimStart()
      if (!/^(\*\*)?Sources:(\*\*)?/i.test(trimmed)) return line
      return line.replace(/\[\s*(\d+)\s*\](?!\()/g, (_m, d) => {
        const key = String(Number(d))
        const src = citations[key]
        if (!src) return `[${d}]`
        const base = (appBaseUrl ?? '').replace(/\/$/, '')
        const href =
          src.kind === 'memory'
            ? `${base}/app/knowledge?memory=${encodeURIComponent(src.sourceId)}`
            : `${base}/app/knowledge?file=${encodeURIComponent(src.sourceId)}`
        return `[${d}](${href})`
      })
    })
    .join('\n')
}

export function normalizeGeneratedMarkdown(
  text: string,
  options?: {
    sourceCitations?: SourceCitationMap
    linkifyCitations?: boolean
    webSources?: WebSourceItem[]
    linkifyWebCitations?: boolean
    appBaseUrl?: string | null
  },
): string {
  let t = mergeGfmTableContinuationLines(stripHtmlishToMarkdown(stripThinkingPlaceholderMarkdown(text)))
  t = bracketNormalize(t)
  // Defuse prose pseudo-math (currency like `$8,000 ... $57,600`) and recover real
  // TeX delimiters before remark-math runs, so currency is not italicized as math.
  t = normalizeAssistantMathMarkdown(t)
  const hasKnowledgeCitations =
    !!(options?.sourceCitations && Object.keys(options.sourceCitations).length > 0)
  const hasWebSources = !!(options?.webSources && options.webSources.length > 0)
  // Strip the redundant trailing "Sources:" prose block — we surface web sources via the sidebar
  // button + inline chips. Keep the block when we only have knowledge citations (those still
  // rely on the numbered list for Knowledge linkify).
  if (hasWebSources && !hasKnowledgeCitations) {
    t = stripTrailingSourcesBlock(t)
  }
  if (
    options?.linkifyWebCitations &&
    options?.webSources &&
    options.webSources.length > 0
  ) {
    t = linkifyInlineWebCitations(t, options.webSources, {
      skipKnowledgeSourceLines: hasKnowledgeCitations,
    })
  }
  if (options?.linkifyCitations && hasKnowledgeCitations) {
    t = linkifySourceCitations(t, options.sourceCitations!, options.appBaseUrl)
  }
  return t
}
