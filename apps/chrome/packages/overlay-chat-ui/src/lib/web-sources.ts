/**
 * Web search / browser tool sources for chat UI (citation chips + sidebar).
 */

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
  try {
    let host = new URL(url).hostname.toLowerCase()
    if (host.startsWith('www.')) host = host.slice(4)
    const parts = host.split('.').filter(Boolean)
    if (parts.length >= 3) {
      return `${parts[0]}.${parts[1]}`
    }
    return parts[0] ?? host
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

function safeReadString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeWebUrl(raw: string): string | null {
  try {
    return new URL(raw).toString()
  } catch {
    return null
  }
}

function pickSourceTitle(entry: Record<string, unknown>, fallbackUrl: string): string {
  const candidate =
    safeReadString(entry.title) ??
    safeReadString(entry.name) ??
    safeReadString(entry.domain) ??
    safeReadString(entry.host)
  if (candidate) return candidate
  try {
    const parsed = new URL(fallbackUrl)
    return parsed.hostname.replace(/^www\./i, '')
  } catch {
    return fallbackUrl
  }
}

/** Walk arbitrary tool output JSON for URLs (used by web-search preview rows). */
export function collectSourceCandidatesFromUnknown(
  value: unknown,
  origin: 'web-search' | 'browser',
  acc: WebSourceItem[],
  seen: Set<string>,
  depth = 0,
): void {
  if (depth > 5) return
  if (Array.isArray(value)) {
    for (const item of value) collectSourceCandidatesFromUnknown(item, origin, acc, seen, depth + 1)
    return
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      const urlMatches = value.match(/https?:\/\/[^\s)\]]+/g)
      if (!urlMatches) return
      for (const rawUrl of urlMatches) {
        const normalized = normalizeWebUrl(rawUrl)
        if (!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        acc.push({
          url: normalized,
          title: pickSourceTitle({}, normalized),
          origin,
        })
      }
    }
    return
  }

  const rec = value as Record<string, unknown>
  const possibleUrl =
    safeReadString(rec.url) ??
    safeReadString(rec.link) ??
    safeReadString(rec.href) ??
    safeReadString(rec.sourceUrl) ??
    safeReadString(rec.source_url)
  if (possibleUrl) {
    const normalized = normalizeWebUrl(possibleUrl)
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      acc.push({
        url: normalized,
        title: pickSourceTitle(rec, normalized),
        snippet:
          safeReadString(rec.snippet) ??
          safeReadString(rec.summary) ??
          safeReadString(rec.description) ??
          undefined,
        origin,
      })
    }
  }

  for (const child of Object.values(rec)) {
    if (child && (typeof child === 'object' || typeof child === 'string')) {
      collectSourceCandidatesFromUnknown(child, origin, acc, seen, depth + 1)
    }
  }
}

/** Sources extracted from a completed Perplexity / browser tool part. */
export function collectWebSourcesFromToolPart(
  toolName: string,
  output: unknown,
  state: string,
): WebSourceItem[] {
  if (state !== 'output-available') return []
  const items: WebSourceItem[] = []
  const seen = new Set<string>()
  const origin =
    toolName === 'perplexity_search' ? 'web-search' : toolName === 'browser_run_task' || toolName === 'interactive_browser_session' ? 'browser' : 'web-search'
  if (toolName === 'perplexity_search' || toolName === 'browser_run_task' || toolName === 'interactive_browser_session') {
    collectSourceCandidatesFromUnknown(output, origin, items, seen)
  }
  return items
}

export function faviconUrl(pageUrl: string): string {
  try {
    const host = new URL(pageUrl).hostname
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`
  } catch {
    return ''
  }
}

export function hostFromUrl(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}
