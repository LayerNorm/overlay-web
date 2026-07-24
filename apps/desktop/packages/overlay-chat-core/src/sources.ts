import type { AssistantVisualBlock, ToolVisualBlock, WebSourceItem } from './types'

export function safeHttpUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function webSourceDisplayKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
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

export function prettyUrlPath(pageUrl: string): string {
  try {
    const u = new URL(pageUrl)
    const path = `${u.pathname}${u.search}`.replace(/\/$/, '')
    if (!path) return ''
    try {
      return decodeURIComponent(path)
    } catch {
      return path
    }
  } catch {
    return ''
  }
}

function safeReadString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function pickSourceTitle(entry: Record<string, unknown>, fallbackUrl: string): string {
  const candidate =
    safeReadString(entry.title) ??
    safeReadString(entry.name) ??
    safeReadString(entry.domain) ??
    safeReadString(entry.host)
  if (candidate) return candidate
  return webSourceDisplayKey(fallbackUrl)
}

function pickSourceSnippet(entry: Record<string, unknown>): string | undefined {
  return (
    safeReadString(entry.snippet) ??
    safeReadString(entry.summary) ??
    safeReadString(entry.description) ??
    undefined
  )
}

function pushSource(
  entry: Record<string, unknown>,
  origin: WebSourceItem['origin'],
  acc: WebSourceItem[],
  seen: Set<string>,
) {
  const rawUrl =
    safeReadString(entry.url) ??
    safeReadString(entry.href) ??
    safeReadString(entry.link) ??
    safeReadString(entry.sourceUrl)
  const url = safeHttpUrl(rawUrl)
  if (!url || seen.has(url)) return
  seen.add(url)
  acc.push({
    url,
    title: pickSourceTitle(entry, url),
    snippet: pickSourceSnippet(entry),
    origin,
  })
}

function extractHttpUrlsFromText(value: string): string[] {
  return value.match(/https?:\/\/[^\s"'<>\\)\]}]+/gi) ?? []
}

function collectSourceCandidatesFromUnknown(
  value: unknown,
  origin: WebSourceItem['origin'],
  acc: WebSourceItem[],
  seen: Set<string>,
  depth = 0,
) {
  if (depth > 6 || value == null) return

  if (typeof value === 'string') {
    for (const rawUrl of extractHttpUrlsFromText(value)) {
      const url = safeHttpUrl(rawUrl.replace(/[.,;]+$/, ''))
      if (!url || seen.has(url)) continue
      seen.add(url)
      acc.push({ url, title: webSourceDisplayKey(url), origin })
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) collectSourceCandidatesFromUnknown(item, origin, acc, seen, depth + 1)
    return
  }

  if (typeof value !== 'object') return
  const rec = value as Record<string, unknown>
  pushSource(rec, origin, acc, seen)

  for (const key of ['sources', 'results', 'citations', 'references', 'pages', 'links', 'items', 'summary']) {
    const child = rec[key]
    if (child) collectSourceCandidatesFromUnknown(child, origin, acc, seen, depth + 1)
  }
}

export function collectWebSourcesFromBlocks(blocks: AssistantVisualBlock[]): WebSourceItem[] {
  const items: WebSourceItem[] = []
  const seen = new Set<string>()
  for (const block of blocks) {
    if (block.kind !== 'tool') continue
    if (block.state !== 'output-available') continue
    if (
      block.name !== 'perplexity_search' &&
      block.name !== 'parallel_search' &&
      block.name !== 'browser_run_task' &&
      block.name !== 'interactive_browser_session'
    ) continue
    collectSourceCandidatesFromUnknown(
      block.toolOutput,
      block.name === 'perplexity_search' || block.name === 'parallel_search' ? 'web-search' : 'browser',
      items,
      seen,
    )
  }
  return items
}

export function collectWebSourcesFromSingleBlock(block: ToolVisualBlock): WebSourceItem[] {
  if (block.state !== 'output-available') return []
  const items: WebSourceItem[] = []
  const seen = new Set<string>()
  collectSourceCandidatesFromUnknown(
    block.toolOutput,
    block.name === 'perplexity_search' || block.name === 'parallel_search' ? 'web-search' : 'browser',
    items,
    seen,
  )
  return items
}
