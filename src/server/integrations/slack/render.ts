import 'server-only'

import type { Element, Root as HastRoot } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import { toMdast } from 'hast-util-to-mdast'
import type {
  Blockquote,
  Code,
  Definition,
  Link,
  List,
  ListItem,
  Nodes,
  Parent,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableRow,
} from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { toMarkdown, type Options as ToMarkdownOptions } from 'mdast-util-to-markdown'
import { toString } from 'mdast-util-to-string'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'

/**
 * Turns a finished Overlay Harness reply into the `{ markdown }` messages the
 * Chat SDK posts to Slack. Slack renders standard markdown (`markdown_text`),
 * so GitHub-flavored structure passes through; Overlay-only syntax (citation
 * numbers, inline HTML, `$…$` math, app-relative links) is rewritten, and long
 * replies are split on block boundaries under Slack's 12,000 character limit.
 * Mentions in the text never ping anyone: an agent must not be able to notify a
 * person, a user group or the whole channel.
 */

export interface SlackReplyMessage {
  markdown: string
}

export interface RenderSlackReplyOptions {
  /** Absolute URL of the Overlay thread; its origin resolves app-relative links. */
  threadUrl: string
  /** Largest message, in characters. Defaults to 11,000 (Slack allows 12,000). */
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 11_000
const MAX_MESSAGES = 4
const SOURCES_LABEL = /^\s*(sources|citations|references)\s*:?/i
const CITATION_MARKER = /\[(\d{1,3})\]/g
const TO_MARKDOWN: ToMarkdownOptions = {
  bullet: '-',
  emphasis: '_',
  strong: '*',
  fences: true,
  listItemIndent: 'one',
  rule: '-',
  handlers: {
    break: () => '\n',
    // Slack does not undo backslash escapes in URLs, so write the destination as is.
    link: (node: Link, _parent, state, info) => {
      const label = state.containerPhrasing(node, { ...info, before: '[', after: ']' })
      return `[${label}](${node.url.replace(/\s/g, encodeURIComponent).replace(/\(/g, '%28').replace(/\)/g, '%29')})`
    },
  },
  extensions: [gfmToMarkdown({ tablePipeAlign: false })],
}

interface Source {
  number: number
  url: string
  title: string
}

export function renderSlackReply(markdown: string, options: RenderSlackReplyOptions): SlackReplyMessage[] {
  if (!markdown.trim()) return []
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const origin = new URL(options.threadUrl).origin

  const tree = fromMarkdown(markdown, {
    extensions: [gfm(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  const definitions = new Map<string, Definition>()
  for (const node of tree.children) {
    if (node.type === 'definition') definitions.set(node.identifier, node)
  }

  const sources = takeSources(tree, origin)
  rewrite(tree, { markdown, origin, definitions, sources: new Map(sources.map((source) => [source.number, source])) })
  if (sources.length > 0) tree.children.push(...sourcesSection(sources))

  const blocks = tree.children.flatMap((block) => fitBlock(block, maxChars))
  const messages = pack(blocks, (group): Root => ({ type: 'root', children: group }), maxChars)
    .map(render)
    .filter(Boolean)
  if (messages.length <= MAX_MESSAGES) return messages.map((text) => ({ markdown: text }))
  return [
    ...messages.slice(0, MAX_MESSAGES - 1).map((text) => ({ markdown: text })),
    { markdown: `_The reply continues in Overlay._ [Read the full reply](${options.threadUrl})` },
  ]
}

// ── Citations ────────────────────────────────────────────────────────────────

/**
 * Removes the trailing "Sources:" block when its entries are links and returns
 * them, so inline `[n]` markers can link to them and the reply ends with a clean
 * list. An unlinked block such as `Sources: [1] [3]` stays as written.
 */
function takeSources(tree: Root, origin: string): Source[] {
  let start = -1
  for (let index = tree.children.length - 1; index >= 0; index--) {
    const node = tree.children[index]!
    if (node.type === 'definition') continue
    if (node.type === 'paragraph' && SOURCES_LABEL.test(toString(node))) {
      start = index
      break
    }
    if (node.type !== 'list' && node.type !== 'paragraph') break
  }
  if (start < 0) return []

  const links: Link[] = []
  for (const node of tree.children.slice(start)) collectLinks(node, links)
  if (links.length === 0) return []

  const sources: Source[] = []
  for (const link of links) {
    const label = toString(link).trim()
    const numbered = /^\d+$/.test(label)
    const number = numbered ? Number(label) : sources.length + 1
    if (sources.some((source) => source.number === number)) continue
    const url = absoluteUrl(link.url, origin)
    sources.push({ number, url, title: link.title?.trim() || (numbered ? '' : label) || new URL(url, origin).hostname })
  }
  tree.children = tree.children.filter((node, index) => index < start || node.type === 'definition')
  return sources
}

function collectLinks(node: Nodes, links: Link[]) {
  if (node.type === 'link') {
    links.push(node)
    return
  }
  if ('children' in node) for (const child of node.children) collectLinks(child, links)
}

function sourcesSection(sources: Source[]): RootContent[] {
  const sorted = [...sources].sort((a, b) => a.number - b.number)
  const sequential = sorted.every((source, index) => source.number === index + 1)
  const items: ListItem[] = sorted.map((source) => ({
    type: 'listItem',
    spread: false,
    children: [{
      type: 'paragraph',
      children: [
        ...(sequential ? [] : [{ type: 'text' as const, value: `[${source.number}] ` }]),
        { type: 'link', url: source.url, children: [{ type: 'text', value: withoutPings(source.title) }] },
      ],
    }],
  }))
  return [
    { type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', value: 'Sources' }] }] },
    { type: 'list', ordered: sequential, start: sequential ? 1 : null, spread: false, children: items },
  ]
}

// ── Overlay-only syntax ──────────────────────────────────────────────────────

interface RewriteContext {
  markdown: string
  origin: string
  definitions: Map<string, Definition>
  sources: Map<number, Source>
}

function rewrite(parent: Parent, context: RewriteContext) {
  const input = parent.children as Nodes[]
  const output: Nodes[] = []
  for (let index = 0; index < input.length; index++) {
    const node = input[index]!
    const close = node.type === 'html' && isPhrasingParent(parent) ? anchorClose(input, index) : -1
    if (close > 0) {
      const link: Link = {
        type: 'link',
        url: absoluteUrl(htmlElement((node as { value: string }).value)?.properties.href?.toString() ?? '', context.origin),
        children: input.slice(index + 1, close) as PhrasingContent[],
      }
      rewrite(link, context)
      output.push(link)
      index = close
      continue
    }
    output.push(...rewriteNode(node, parent, context))
  }
  parent.children = output as Parent['children']
}

function rewriteNode(node: Nodes, parent: Parent, context: RewriteContext): Nodes[] {
  switch (node.type) {
    case 'definition':
      return []
    case 'link':
      node.url = absoluteUrl(node.url, context.origin)
      rewrite(node, context)
      return [node]
    case 'linkReference': {
      const definition = context.definitions.get(node.identifier)
      if (!definition) return [{ type: 'text', value: `[${toString(node)}]` }]
      const link: Link = { type: 'link', url: absoluteUrl(definition.url, context.origin), title: definition.title, children: node.children }
      rewrite(link, context)
      return [link]
    }
    case 'image':
      return [embedLink(node.url, node.alt, context.origin)]
    case 'imageReference': {
      const definition = context.definitions.get(node.identifier)
      return definition ? [embedLink(definition.url, node.alt, context.origin)] : [{ type: 'text', value: node.alt ?? '' }]
    }
    case 'inlineMath': {
      const offset = node.position?.start.offset ?? 0
      const singleDollar = context.markdown.slice(offset, offset + 2) !== '$$'
      // Prose like "$8,000 to $9,500" parses as math; keep it as the currency it is.
      if (singleDollar && /^[\d\s]|\s$/.test(node.value)) return [{ type: 'text', value: `$${node.value}$` }]
      return [{ type: 'inlineCode', value: node.value }]
    }
    case 'math':
      return [{ type: 'code', lang: 'latex', value: node.value }]
    case 'html': {
      // Markdown reads Slack's special mentions (<!channel>, <!here>, <!subteam^…>) as HTML; keep them as plain text.
      const special = node.value.trim()
      if (SLACK_SPECIAL_MENTION.test(special)) {
        const text: PhrasingContent = { type: 'text', value: withoutPings(special) }
        return isPhrasingParent(parent) ? [text] : [{ type: 'paragraph', children: [text] }]
      }
      return isPhrasingParent(parent) ? htmlInline(node.value, context) : htmlBlock(node.value, context)
    }
    case 'text': {
      node.value = withoutPings(node.value)
      return context.sources.size > 0 ? linkCitations(node.value, context.sources) : [node]
    }
    default:
      if ('children' in node) rewrite(node, context)
      return [node]
  }
}

const SLACK_SPECIAL_MENTION = /^<![a-z][^<>\s]*>$/i
const WORD_JOINER = '\u2060'

/**
 * Slack mention markup (`<@U123>`, `<!here>`, `<!subteam^S1|@eng>`) becomes its plain name, and a bare `@name`
 * gets an invisible word joiner after the `@`, which stops both Slack and the Chat SDK (which turns `@name` into a
 * mention) from linking it. Code spans are separate nodes and stay as written; emails are untouched.
 */
export function withoutPings(value: string): string {
  return value
    .replace(/<([@!])([^<>|\s]+)(?:\|([^<>]*))?>/g, (_token, sigil: string, id: string, label: string | undefined) => {
      if (label) return label.startsWith('@') ? label : '@' + label
      return '@' + (sigil === '!' ? id.split('^')[0] : id)
    })
    .replace(/(^|[^\p{L}\p{N}_])@(?=[\p{L}\p{N}_])/gu, '$1@' + WORD_JOINER)
}

function isPhrasingParent(parent: Parent): boolean {
  return !['root', 'blockquote', 'listItem', 'footnoteDefinition'].includes(parent.type)
}

function linkCitations(value: string, sources: Map<number, Source>): PhrasingContent[] {
  const parts: PhrasingContent[] = []
  let last = 0
  for (const match of value.matchAll(CITATION_MARKER)) {
    const source = sources.get(Number(match[1]))
    if (!source) continue
    if (match.index > last) parts.push({ type: 'text', value: value.slice(last, match.index) })
    parts.push({ type: 'link', url: source.url, children: [{ type: 'text', value: `[${match[1]}]` }] })
    last = match.index + match[0].length
  }
  if (last === 0) return [{ type: 'text', value }]
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) })
  return parts
}

function embedLink(url: string, label: string | null | undefined, origin: string): Link {
  const absolute = absoluteUrl(url, origin)
  return { type: 'link', url: absolute, children: [{ type: 'text', value: withoutPings(label?.trim() || 'Image') }] }
}

function absoluteUrl(url: string, origin: string): string {
  if (!url.startsWith('/') || url.startsWith('//')) return url
  return new URL(url, origin).toString()
}

function htmlElement(value: string): Element | undefined {
  return fromHtml(value, { fragment: true }).children.find((child): child is Element => child.type === 'element')
}

/** Index of the `</a>` closing an inline `<a href>` opened at `index`, or -1. */
function anchorClose(nodes: Nodes[], index: number): number {
  const opening = nodes[index]
  if (opening?.type !== 'html' || htmlElement(opening.value)?.tagName !== 'a' || /<\/a\s*>/i.test(opening.value)) return -1
  return nodes.findIndex((node, at) => at > index && node.type === 'html' && /^<\/a\s*>$/i.test(node.value.trim()))
}

/** Inline tags such as `<u>`, `<mark>` or `<sub>` disappear and leave their text. */
function htmlInline(value: string, context: RewriteContext): PhrasingContent[] {
  const element = htmlElement(value)
  if (!element) return []
  if (element.tagName === 'br') return [{ type: 'break' }]
  const src = element.properties.src?.toString()
  if (!src) return []
  return [embedLink(src, element.properties.alt?.toString() || element.properties.title?.toString(), context.origin)]
}

/**
 * Block HTML (aligned paragraphs, embeds, figures) becomes ordinary markdown
 * through hast-util-to-mdast, with images and embeds as links to their source.
 */
function htmlBlock(value: string, context: RewriteContext): Nodes[] {
  const embed = (_state: unknown, node: Element): Link | undefined => {
    const src = node.properties.src?.toString()
    if (!src) return undefined
    const label = node.properties.title?.toString() || node.properties.alt?.toString() || 'Embedded content'
    return embedLink(src, label, context.origin)
  }
  const converted = toMdast(fromHtml(value, { fragment: true }) as HastRoot, {
    handlers: { iframe: embed, video: embed, embed, img: embed, u: unwrap, mark: unwrap },
  }) as Root
  const wrapper: Root = { type: 'root', children: [] }
  let phrasing: PhrasingContent[] = []
  const flush = () => {
    if (phrasing.some((node) => node.type !== 'text' || node.value.trim())) wrapper.children.push({ type: 'paragraph', children: phrasing })
    phrasing = []
  }
  for (const node of converted.children) {
    if (PHRASING.has(node.type)) phrasing.push(node as PhrasingContent)
    else {
      flush()
      wrapper.children.push(node)
    }
  }
  flush()
  rewrite(wrapper, context)
  return wrapper.children
}

const unwrap = (state: { all: (node: Element) => unknown[] }, node: Element) => state.all(node) as PhrasingContent[]

const PHRASING = new Set(['text', 'emphasis', 'strong', 'delete', 'link', 'inlineCode', 'break', 'image'])

// ── Splitting ────────────────────────────────────────────────────────────────

function render(value: Root | RootContent): string {
  return toMarkdown(value.type === 'root' ? value : { type: 'root', children: [value] }, TO_MARKDOWN).trim()
}

/** Splits one block into pieces that each fit, never inside a fence or table row. */
function fitBlock(node: RootContent, max: number): RootContent[] {
  if (render(node).length <= max) return [node]
  switch (node.type) {
    case 'code':
      return splitCode(node, max)
    case 'table': {
      const [header, ...rows] = node.children
      if (!header || rows.length === 0) break
      return pack(rows, (group: TableRow[]): Table => ({ ...node, children: [header, ...group] }), max)
    }
    case 'list': {
      const start = node.start ?? 1
      const items = node.children.map((item, offset) => ({ item, offset }))
      return pack(items, (group): List => ({
        ...node,
        start: node.ordered ? start + group[0]!.offset : node.start,
        children: group.map(({ item }) => item),
      }), max)
    }
    case 'blockquote':
      return pack(node.children.flatMap((child) => fitBlock(child, max - 2)), (group): Blockquote => ({ ...node, children: group as Blockquote['children'] }), max)
  }
  return splitText(render(node), max)
}

/** Splits a fence by lines (and over-long lines by characters), re-opening the fence each time. */
function splitCode(node: Code, max: number): RootContent[] {
  const room = Math.max(1, max - render({ ...node, value: '' }).length - 1)
  const lines = node.value.split('\n').flatMap((line) => {
    const pieces: string[] = []
    for (let at = 0; at < line.length; at += room) pieces.push(line.slice(at, at + room))
    return pieces.length > 0 ? pieces : ['']
  })
  return pack(lines, (group): Code => ({ ...node, value: group.join('\n') }), max)
}

/** Last resort for one oversized paragraph or heading: break on whitespace. */
function splitText(text: string, max: number): RootContent[] {
  const pieces: RootContent[] = []
  let rest = text
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '))
    const end = cut > max / 2 ? cut : max
    pieces.push({ type: 'html', value: rest.slice(0, end).trimEnd() })
    rest = rest.slice(end).trimStart()
  }
  if (rest) pieces.push({ type: 'html', value: rest })
  return pieces
}

/** Greedily groups consecutive units while the wrapped group still fits. */
function pack<Unit, Out extends Root | RootContent>(units: Unit[], wrap: (group: Unit[]) => Out, max: number): Array<Out | RootContent> {
  const out: Array<Out | RootContent> = []
  let current: Unit[] = []
  for (const unit of units) {
    if (render(wrap([...current, unit])).length <= max) {
      current.push(unit)
      continue
    }
    if (current.length > 0) out.push(wrap(current))
    current = [unit]
    const alone = render(wrap(current))
    if (alone.length > max) {
      out.push(...splitText(alone, max))
      current = []
    }
  }
  if (current.length > 0) out.push(wrap(current))
  return out
}
