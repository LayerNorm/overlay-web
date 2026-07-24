import type { MessageToolPart } from '@overlay/chat-core'
import { safeHttpUrl } from './safe-url'
import type { WebSourceItem } from './web-sources'

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
  return hostFromUrl(fallbackUrl) || fallbackUrl
}

function collectSourceCandidatesFromUnknown(
  value: unknown,
  origin: 'web-search' | 'browser',
  acc: WebSourceItem[],
  seen: Set<string>,
  depth = 0,
) {
  if (depth > 5) return
  if (Array.isArray(value)) {
    for (const item of value) collectSourceCandidatesFromUnknown(item, origin, acc, seen, depth + 1)
    return
  }
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return
    const matches = value.match(/https?:\/\/[^\s)\]]+/g)
    if (!matches) return
    for (const rawUrl of matches) {
      const normalized = safeHttpUrl(rawUrl)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      acc.push({ url: normalized, title: pickSourceTitle({}, normalized), origin })
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
    const normalized = safeHttpUrl(possibleUrl)
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      acc.push({
        url: normalized,
        title: pickSourceTitle(rec, normalized),
        snippet:
          safeReadString(rec.snippet) ??
          safeReadString(rec.excerpt) ??
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

export function collectWebSourcesFromToolPart(
  toolName: string,
  output: MessageToolPart['output'],
  state: MessageToolPart['state'],
): WebSourceItem[] {
  if (state !== 'output-available') return []
  const origin = toolName === 'perplexity_search' || toolName === 'parallel_search' ? 'web-search' : 'browser'
  const items: WebSourceItem[] = []
  collectSourceCandidatesFromUnknown(output, origin, items, new Set())
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
