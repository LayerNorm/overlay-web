/**
 * Web search / browser tool sources for chat UI (citation chips + sidebar).
 */
import { safeHttpUrl } from './safe-url'

export type WebSourceItem = {
  url: string
  title: string
  snippet?: string
  origin: 'web-search' | 'browser'
}

/** Hash href for markdown (survives rehype-sanitize; click opens real URL in React). */
export function webCitationMarkdownHref(indexOneBased: number): string {
  return `#overlay-webcite-${indexOneBased}`
}

/**
 * Multi-citation href for a *run* of consecutive `[n]` markers.
 * Chip tooltip expands these into a per-source list.
 */
export function webCitationMultiMarkdownHref(indicesOneBased: number[]): string {
  return `#overlay-webcite-multi-${indicesOneBased.join('-')}`
}

/** Chip label when a citation run covers multiple sources — shows leading site key + "+N" extras. */
export function webCitationRunLabel(sources: WebSourceItem[], indicesOneBased: number[]): string {
  if (indicesOneBased.length === 0) return 'source'
  const firstIdx = indicesOneBased[0]! - 1
  const firstLabel = webSourceDisplayKey(sources[firstIdx]?.url ?? '')
  const extra = indicesOneBased.length - 1
  return extra > 0 ? `${firstLabel} +${extra}` : firstLabel
}

/** Short host label for inline chips (matches common citation UIs). */
export function webSourceDisplayKey(url: string): string {
  const safe = safeHttpUrl(url)
  if (!safe) return 'source'
  try {
    let host = new URL(safe).hostname.toLowerCase()
    if (host.startsWith('www.')) host = host.slice(4)
    return host
  } catch {
    return 'source'
  }
}

/**
 * Label like `medlineplus +1` / `medlineplus +2` when multiple hits share the same display key.
 */
export function webCitationChipLabel(sources: WebSourceItem[], indexZeroBased: number): string {
  const src = sources[indexZeroBased]
  if (!src) return `${indexZeroBased + 1}`
  const key = webSourceDisplayKey(src.url)
  let rank = 1
  for (let i = 0; i < indexZeroBased; i++) {
    if (webSourceDisplayKey(sources[i]!.url) === key) rank += 1
  }
  return `${key} +${rank}`
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
 * Turn prose `[n]` into markdown links `overlay-web-cite:n` with readable chip text.
 * Skips **Sources:** lines when knowledge citations are present (those stay for notebook linkify).
 */
export function linkifyInlineWebCitations(
  text: string,
  sources: WebSourceItem[],
  options?: { skipKnowledgeSourceLines?: boolean },
): string {
  if (!sources.length) return text
  return transformOutsideCodeFences(text, (chunk) => {
    const lines = chunk.split('\n')
    return lines
      .map((line) => {
        const trimmed = line.trimStart()
        if (options?.skipKnowledgeSourceLines && /^(\*\*)?Sources:(\*\*)?/i.test(trimmed)) {
          return line
        }
        // Match runs of consecutive `[n]` markers (optional whitespace / commas between them)
        // and collapse each run into one chip whose tooltip expands to every source it covers.
        return line.replace(
          /(?<!\[)(?:\[\s*\d+\s*\](?:\s*[, ]\s*|\s*))+/g,
          (full) => {
            const indices: number[] = []
            const perMarker = /\[\s*(\d+)\s*\]/g
            let m: RegExpExecArray | null
            while ((m = perMarker.exec(full)) !== null) {
              const idx = Number(m[1])
              if (Number.isFinite(idx) && idx >= 1 && idx <= sources.length) {
                if (!indices.includes(idx)) indices.push(idx)
              }
            }
            if (indices.length === 0) return full
            if (indices.length === 1) {
              const idx = indices[0]!
              const label = webSourceDisplayKey(sources[idx - 1]?.url ?? '')
              return `[${label}](${webCitationMarkdownHref(idx)})`
            }
            const label = webCitationRunLabel(sources, indices)
            return `[${label}](${webCitationMultiMarkdownHref(indices)})`
          },
        )
      })
      .join('\n')
  })
}
