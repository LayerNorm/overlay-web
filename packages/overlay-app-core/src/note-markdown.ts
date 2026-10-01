import type { Element, ElementContent, Nodes as HastNodes, Root as HastRoot } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import { raw } from 'hast-util-raw'
import { defaultSchema, sanitize, type Schema } from 'hast-util-sanitize'
import { toHtml } from 'hast-util-to-html'
import { defaultHandlers, toMdast, type Handle, type State } from 'hast-util-to-mdast'
import type { List, ListItem, Nodes as MdastNodes, PhrasingContent, Root as MdastRoot } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown, mathToMarkdown, type InlineMath, type Math } from 'mdast-util-math'
import { defaultHandlers as mdastDefaultHandlers, toHast, type Handler, type State as ToHastState } from 'mdast-util-to-hast'
import { toMarkdown, type Handle as ToMarkdownHandle } from 'mdast-util-to-markdown'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'

/**
 * Notes are stored as GitHub-flavored Markdown with `$…$` / `$$…$$` math.
 * Editor features Markdown cannot express (underline, highlight, sub/sup,
 * alignment, YouTube embeds, tables with merged or sized cells) are kept as
 * small inline HTML, which the editor, the share page, and agents all read.
 *
 * The editor works in TipTap HTML, so it converts with
 * `noteMarkdownToEditorHtml` on load and `editorHtmlToNoteMarkdown` on save.
 * Notes written before the Markdown switch hold TipTap HTML;
 * `toCanonicalNoteMarkdown` converts those on read and in the backfill.
 */

const BLOCK_TAG = /^<(p|h[1-6]|ul|ol|pre|blockquote|table|div|hr|img)[\s>/]/i
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\(\s*[\d.\s,%]+\))$/i
const YOUTUBE_EMBED = /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/[\w-]+(\?[\w=&%-]*)?$/

/**
 * True when `content` is legacy TipTap HTML rather than Markdown. TipTap
 * serializes a document as block elements with nothing between them, while
 * Markdown always has text (at least newlines) between blocks. A Markdown note
 * that is a single raw-HTML block also matches, and converting it is a no-op.
 */
export function isLegacyNoteHtml(content: string): boolean {
  const trimmed = content.trim()
  if (!BLOCK_TAG.test(trimmed)) return false
  const tree = fromHtml(trimmed, { fragment: true })
  return tree.children.every((child) => child.type === 'element' || child.type === 'comment')
}

export function toCanonicalNoteMarkdown(content: string): string {
  return isLegacyNoteHtml(content) ? editorHtmlToNoteMarkdown(content) : content
}

// ── HTML → Markdown ─────────────────────────────────────────────────────────

function dataAttr(node: Element, name: string): string | undefined {
  const value = node.properties?.[name]
  return typeof value === 'string' ? value : undefined
}

function htmlNode(value: string): MdastNodes {
  return { type: 'html', value }
}

const DEFAULT_ONE = new Set(['colSpan', 'rowSpan'])

/** Drops editor-only noise (layout styles, default spans, embed options) before keeping HTML in Markdown. */
function compactHtml(node: Element): string {
  const visit = (element: Element): Element => {
    const properties = { ...element.properties }
    if (['table', 'col', 'colgroup'].includes(element.tagName)) delete properties.style
    for (const key of DEFAULT_ONE) if (Number(properties[key]) === 1) delete properties[key]
    if (element.tagName === 'iframe') {
      return { ...element, properties: { src: properties.src }, children: [] }
    }
    return {
      ...element,
      properties,
      children: element.children.map((child) => (child.type === 'element' ? visit(child) : child)),
    }
  }
  return toHtml(visit(node))
}

function inlineHtmlWrapper(state: State, node: Element): Array<MdastNodes> {
  const shell = toHtml({ ...node, children: [] })
  const close = `</${node.tagName}>`
  const open = shell.slice(0, shell.length - close.length)
  return [htmlNode(open), ...(state.all(node) as Array<PhrasingContent>), htmlNode(close)]
}

function alignedBlock(node: Element): boolean {
  const style = node.properties?.style
  return typeof style === 'string' && /text-align:\s*(center|right|justify)/.test(style)
}

function withAlignment(fallback: Handle): Handle {
  return (state, node, parent) => (alignedBlock(node) ? htmlNode(compactHtml(node)) : fallback(state, node, parent))
}

const CELL_BLOCK_TAGS = new Set(['p', 'div', 'ul', 'ol', 'pre', 'blockquote', 'table', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

function cellIsSimple(cell: Element): boolean {
  if (Number(cell.properties?.colSpan ?? 1) > 1 || Number(cell.properties?.rowSpan ?? 1) > 1) return false
  if (cell.properties?.colwidth) return false
  // Inline formatting is fine; at most one paragraph of block content.
  const blocks = cell.children.filter((child): child is Element => child.type === 'element' && CELL_BLOCK_TAGS.has(child.tagName))
  return blocks.length <= 1 && blocks.every((block) => block.tagName === 'p' && !alignedBlock(block))
}

function tableRows(table: Element): Element[] {
  const rows: Element[] = []
  const visit = (node: Element) => {
    for (const child of node.children) {
      if (child.type !== 'element') continue
      if (child.tagName === 'tr') rows.push(child)
      else if (['thead', 'tbody', 'tfoot'].includes(child.tagName)) visit(child)
    }
  }
  visit(table)
  return rows
}

/** GFM tables need a header row and single-paragraph cells; anything richer stays HTML. */
function gfmCompatibleTable(table: Element): boolean {
  const rows = tableRows(table)
  if (rows.length === 0) return false
  const cells = (row: Element) => row.children.filter((child): child is Element => child.type === 'element')
  const header = cells(rows[0]!)
  if (header.length === 0 || !header.every((cell) => cell.tagName === 'th')) return false
  return rows.every((row) => cells(row).every(cellIsSimple))
}

const htmlToMdastHandlers: Record<string, Handle> = {
  u: inlineHtmlWrapper,
  mark: inlineHtmlWrapper,
  sub: inlineHtmlWrapper,
  sup: inlineHtmlWrapper,
  p: withAlignment(defaultHandlers.p!),
  h1: withAlignment(defaultHandlers.h1!),
  h2: withAlignment(defaultHandlers.h2!),
  h3: withAlignment(defaultHandlers.h3!),
  table(state, node) {
    return gfmCompatibleTable(node) ? defaultHandlers.table!(state, node) : htmlNode(compactHtml(node))
  },
  span(state, node) {
    if (dataAttr(node, 'dataType') === 'inline-math') {
      return { type: 'inlineMath', value: dataAttr(node, 'dataLatex') ?? '' } satisfies InlineMath
    }
    return defaultHandlers.span!(state, node)
  },
  div(state, node) {
    if (dataAttr(node, 'dataType') === 'block-math') {
      return { type: 'math', value: dataAttr(node, 'dataLatex') ?? '' } satisfies Math
    }
    if (node.properties?.dataYoutubeVideo !== undefined) return htmlNode(compactHtml(node))
    return defaultHandlers.div!(state, node)
  },
  li(state, node) {
    if (dataAttr(node, 'dataType') !== 'taskItem') return defaultHandlers.li!(state, node)
    // TipTap: <li data-type="taskItem" data-checked><label>…</label><div>…</div></li>
    // Converted Markdown (no label/div wrapper) holds the paragraphs directly.
    const body = node.children.find(
      (child): child is Element => child.type === 'element' && child.tagName === 'div',
    )
    const item: ListItem = {
      type: 'listItem',
      checked: dataAttr(node, 'dataChecked') === 'true',
      spread: false,
      children: state.toFlow(state.all(body ?? node)) as ListItem['children'],
    }
    state.patch(node, item)
    return item
  },
  label: () => undefined,
  input: () => undefined,
}

/**
 * Empty inline-math spans read as nothing to whitespace collapsing, which then
 * eats the space after them; give them their LaTeX as text first.
 */
function fillInlineMath(node: HastNodes): void {
  if (node.type === 'element' && node.tagName === 'span' && dataAttr(node, 'dataType') === 'inline-math') {
    node.children = [{ type: 'text', value: dataAttr(node, 'dataLatex') ?? '' }]
    return
  }
  if ('children' in node) for (const child of node.children) fillInlineMath(child)
}

/** The editor wraps every list item in a paragraph, so looseness carries no meaning. */
function tightenLists(node: MdastNodes): void {
  if (node.type === 'list' || node.type === 'listItem') node.spread = false
  if ('children' in node) for (const child of node.children) tightenLists(child)
}

/**
 * The editor often puts the space beside bold or italic text inside it
 * (`<strong> Goal</strong>`). Markdown cannot open emphasis on a space, so the
 * serializer escapes the neighboring characters instead, which reads badly and
 * splits emoji. Moving that whitespace outside the span avoids both.
 */
function hoistEmphasisWhitespace(node: MdastNodes): void {
  if (!('children' in node)) return
  const children = node.children as MdastNodes[]
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!
    hoistEmphasisWhitespace(child)
    if (child.type !== 'strong' && child.type !== 'emphasis' && child.type !== 'delete') continue
    const first = child.children[0]
    const last = child.children[child.children.length - 1]
    const lead = first?.type === 'text' ? /^\s+/.exec(first.value)?.[0] ?? '' : ''
    const trail = last?.type === 'text' ? /\s+$/.exec(last.value)?.[0] ?? '' : ''
    if (lead && first?.type === 'text') first.value = first.value.slice(lead.length)
    if (trail && last?.type === 'text') last.value = last.value.slice(0, last.value.length - trail.length)
    const empty = child.children.every((part) => part.type === 'text' && !part.value)
    const inserted: MdastNodes[] = [
      ...(lead ? [{ type: 'text', value: lead } as MdastNodes] : []),
      // An emphasis that held only whitespace has nothing left to emphasize.
      ...(empty ? [] : [child]),
      // When the span was only whitespace, `lead` and `trail` are the same text.
      ...(trail && !empty ? [{ type: 'text', value: trail } as MdastNodes] : []),
    ]
    children.splice(index, 1, ...inserted)
    index += inserted.length - 1
  }
}

/** Rejoins a surrogate pair the serializer split into a lone half and a character reference. */
function repairSplitSurrogates(markdown: string): string {
  return markdown
    .replace(/([\uD800-\uDBFF])&#x(D[C-F][0-9A-F]{2});/gi, (_match, high: string, low: string) => high + String.fromCharCode(parseInt(low, 16)))
    .replace(/&#x(D[89AB][0-9A-F]{2});([\uDC00-\uDFFF])/gi, (_match, high: string, low: string) => String.fromCharCode(parseInt(high, 16)) + low)
}

export function editorHtmlToNoteMarkdown(html: string): string {
  if (!html.trim()) return ''
  const tree = fromHtml(html, { fragment: true })
  fillInlineMath(tree)
  const mdast = toMdast(tree, { handlers: htmlToMdastHandlers }) as MdastRoot
  tightenLists(mdast)
  hoistEmphasisWhitespace(mdast)
  return serializeNoteMarkdown(mdast)
}

const mathMarkdown = mathToMarkdown()

/** GFM splits table rows on `|` before reading inline content, so math in a cell escapes its pipes like code does. */
const inlineMathInTables: ToMarkdownHandle = (node, parent, state, info) => {
  const math = node as InlineMath
  const value = state.stack.includes('tableCell') ? math.value.replace(/\|/g, '\\|') : math.value
  return (mathMarkdown.handlers!.inlineMath as ToMarkdownHandle)({ ...math, value }, parent, state, info)
}

export function serializeNoteMarkdown(mdast: MdastRoot): string {
  const markdown = toMarkdown(mdast, {
    bullet: '-',
    emphasis: '*',
    fences: true,
    listItemIndent: 'one',
    rule: '-',
    strong: '*',
    // `$` must be escaped in table cells too, or `$16 | $5` reads back as
    // inline math spanning the cell separator.
    extensions: [
      gfmToMarkdown(),
      mathMarkdown,
      { handlers: { inlineMath: inlineMathInTables }, unsafe: [{ character: '$', inConstruct: 'tableCell' }] },
    ],
  })
  return markdown.trim() ? repairSplitSurrogates(markdown) : ''
}

// ── Markdown → HTML ─────────────────────────────────────────────────────────

/** Undoes the `\\|` a table cell needs around inline math (GFM does the same for code). */
function unescapeTableMathPipes(node: MdastNodes, inCell = false): void {
  if (inCell && node.type === 'inlineMath') node.value = node.value.replace(/\\\|/g, '|')
  if ('children' in node) for (const child of node.children) unescapeTableMathPipes(child, inCell || node.type === 'tableCell')
}

export function parseNoteMarkdown(markdown: string): MdastRoot {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  unescapeTableMathPipes(tree)
  return tree
}

function isTaskList(list: List): boolean {
  return list.children.some((item) => typeof item.checked === 'boolean')
}

const mdastToHastHandlers: Record<string, Handler> = {
  inlineMath(_state: ToHastState, node: InlineMath): Element {
    return {
      type: 'element',
      tagName: 'span',
      properties: { dataType: 'inline-math', dataLatex: node.value },
      children: [],
    }
  },
  math(_state: ToHastState, node: Math): Element {
    return {
      type: 'element',
      tagName: 'div',
      properties: { dataType: 'block-math', dataLatex: node.value },
      children: [],
    }
  },
  list(state: ToHastState, node: List): Element {
    if (!isTaskList(node)) return mdastDefaultHandlers.list(state, node)
    const items: ElementContent[] = node.children.map((item) => ({
      type: 'element',
      tagName: 'li',
      properties: { dataType: 'taskItem', dataChecked: item.checked === true ? 'true' : 'false' },
      children: state.all(item) as ElementContent[],
    }))
    return { type: 'element', tagName: 'ul', properties: { dataType: 'taskList' }, children: items }
  },
}

const noteSanitizeSchema: Schema = {
  ...defaultSchema,
  clobberPrefix: '',
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'mark', 'iframe', 'span', 'div'],
  protocols: { ...defaultSchema.protocols, src: ['http', 'https', 'data'] },
  attributes: {
    ...defaultSchema.attributes,
    span: ['dataType', 'dataLatex'],
    div: ['dataType', 'dataLatex', 'dataYoutubeVideo'],
    ul: ['dataType'],
    li: ['dataType', 'dataChecked'],
    mark: ['dataColor', 'style'],
    p: ['style'],
    h1: ['style'],
    h2: ['style'],
    h3: ['style'],
    td: [...(defaultSchema.attributes?.td ?? []), 'colSpan', 'rowSpan', 'colwidth', 'style'],
    th: [...(defaultSchema.attributes?.th ?? []), 'colSpan', 'rowSpan', 'colwidth', 'style'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    iframe: ['src', 'width', 'height', 'allowFullScreen'],
    code: [['className', /^language-./]],
  },
}

function safeStyle(style: string): string | undefined {
  const kept = style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const [rawProperty, ...rest] = declaration.split(':')
      const property = rawProperty?.trim().toLowerCase()
      const value = rest.join(':').trim()
      if (property === 'text-align') return /^(left|center|right|justify)$/.test(value)
      if (property === 'background-color' || property === 'color') return SAFE_COLOR.test(value) || value === 'inherit'
      return false
    })
  return kept.length > 0 ? kept.join('; ') : undefined
}

function scrubUnsafeValues(node: HastNodes): void {
  if (node.type === 'element') {
    const properties = node.properties ?? {}
    if (typeof properties.style === 'string') {
      const style = safeStyle(properties.style)
      if (style) properties.style = style
      else delete properties.style
    }
    if (node.tagName === 'iframe' && !(typeof properties.src === 'string' && YOUTUBE_EMBED.test(properties.src))) {
      delete properties.src
    }
    if (node.tagName !== 'img' && typeof properties.src === 'string' && properties.src.startsWith('data:')) {
      delete properties.src
    }
  }
  if ('children' in node) for (const child of node.children) scrubUnsafeValues(child)
}

/** Sanitized HTML for the note editor (and any other HTML renderer of a note). */
export function noteMarkdownToEditorHtml(markdown: string): string {
  if (!markdown.trim()) return ''
  const mdast = parseNoteMarkdown(markdown)
  const hast = toHast(mdast, { allowDangerousHtml: true, handlers: mdastToHastHandlers }) as HastRoot
  const parsed = raw(hast) as HastRoot
  const clean = sanitize(parsed, noteSanitizeSchema) as HastRoot
  scrubUnsafeValues(clean)
  clean.children = clean.children.filter((child) => !(child.type === 'text' && !child.value.trim()))
  return toHtml(clean)
}
