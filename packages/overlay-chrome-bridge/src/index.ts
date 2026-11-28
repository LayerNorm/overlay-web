/**
 * The contract between the Overlay Chrome extension's side panel and the web app it frames.
 *
 * The side panel is an extension page that frames the web app full-bleed (the way the desktop app loads it) and
 * answers a few requests over `postMessage`. Both sides check the other's origin and drop anything that does not
 * parse. The app only asks; the extension never pushes browsing data on its own.
 */

/** Fixed by the manifest `key`, so the web app can allow exactly this origin to frame it. */
export const CHROME_EXTENSION_ID = 'hcbjdhncedoncldgcodomajeogigipml'
export const CHROME_EXTENSION_ORIGIN = `chrome-extension://${CHROME_EXTENSION_ID}`

/** Origins allowed to frame the web app, for the `frame-ancestors` directive. */
export const CHROME_EXTENSION_FRAME_ANCESTORS = [CHROME_EXTENSION_ORIGIN] as const

const CHANNEL = 'overlay-chrome'
const VERSION = 1

/** The longest page text the extension returns, in characters. */
export const PAGE_TEXT_LIMIT = 60_000

/** The tab the side panel sits next to. */
export type ChromePage = { url: string; title: string }

/** What "Add this page" attaches: the page, the person's selection, and its visible text. */
export type ChromePageContext = ChromePage & { selection: string; text: string; truncated: boolean }

export type ChromeAppRequest =
  | { type: 'page.current'; id: string }
  | { type: 'page.context'; id: string }

export type ChromeExtensionReply =
  | { type: 'page.current'; id: string; page: ChromePage | null }
  | { type: 'page.context'; id: string; context: ChromePageContext | null; error?: string }

type Envelope<T> = T & { channel: typeof CHANNEL; v: typeof VERSION }

export function envelope<T extends ChromeAppRequest | ChromeExtensionReply>(message: T): Envelope<T> {
  return { channel: CHANNEL, v: VERSION, ...message }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

const str = (value: unknown, max = 4_096): value is string => typeof value === 'string' && value.length <= max

function framed(data: unknown): Record<string, unknown> | null {
  const message = record(data)
  return message && message.channel === CHANNEL && message.v === VERSION ? message : null
}

function page(value: unknown): ChromePage | null {
  const item = record(value)
  if (!item || !str(item.url) || !str(item.title) || !/^https?:\/\//.test(item.url)) return null
  return { url: item.url, title: item.title }
}

function pageContext(value: unknown): ChromePageContext | null {
  const item = record(value)
  const base = page(value)
  if (!item || !base || !str(item.selection, PAGE_TEXT_LIMIT) || !str(item.text, PAGE_TEXT_LIMIT) || typeof item.truncated !== 'boolean') return null
  return { ...base, selection: item.selection, text: item.text, truncated: item.truncated }
}

/** Parses a request from the framed app. Run only on messages whose origin is the configured app origin. */
export function parseAppRequest(data: unknown): ChromeAppRequest | null {
  const message = framed(data)
  if (!message) return null
  if ((message.type === 'page.current' || message.type === 'page.context') && str(message.id, 64)) {
    return { type: message.type, id: message.id }
  }
  return null
}

/** Parses a reply from the extension. Run only on messages whose origin is `CHROME_EXTENSION_ORIGIN`. */
export function parseExtensionReply(data: unknown): ChromeExtensionReply | null {
  const message = framed(data)
  if (!message) return null
  if (!str(message.id, 64)) return null
  if (message.type === 'page.current') {
    return { type: 'page.current', id: message.id, page: message.page === null ? null : page(message.page) }
  }
  if (message.type === 'page.context') {
    const context = message.context === null ? null : pageContext(message.context)
    return { type: 'page.context', id: message.id, context, ...(str(message.error, 500) ? { error: message.error } : {}) }
  }
  return null
}

/** Trims page text to the bridge limit. The extension runs this on the page's text before replying. */
export function clipPageText(text: string): { text: string; truncated: boolean } {
  const normalized = text.replace(/\n{3,}/g, '\n\n').trim()
  return normalized.length > PAGE_TEXT_LIMIT
    ? { text: normalized.slice(0, PAGE_TEXT_LIMIT), truncated: true }
    : { text: normalized, truncated: false }
}

/** The Markdown file "Add this page" attaches: title, address, the selection if any, then the page text. */
export function pageContextFile(context: ChromePageContext): { name: string; content: string } {
  const title = context.title.trim() || new URL(context.url).hostname
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Page'
  const sections = [`# ${title}`, '', context.url]
  if (context.selection.trim()) sections.push('', '## Selected text', '', context.selection.trim())
  if (context.text) sections.push('', '## Page text', '', context.text)
  if (context.truncated) sections.push('', '_The page text was cut short._')
  return { name: `${base}.md`, content: `${sections.join('\n')}\n` }
}
