import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize,{ defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Pluggable } from 'unified'

const mdSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'br', 'span'],
  attributes: {
    ...defaultSchema.attributes,
    br: [],
    // Only allow the precise span classes used for the streaming indicator and the
    // per-character fade-in wrappers. rehype-sanitize will drop any other class or
    // attribute, preventing abuse of arbitrary inline HTML.
    span: [
      ['className', 'overlay-stream-marker', 'md-char'],
      'aria-hidden',
    ],
  },
}

/** `strict: 'ignore'` avoids console noise for Unicode punctuation in math-adjacent text. */
const rehypeKatexSafe: Pluggable = [rehypeKatex, { strict: 'ignore', throwOnError: false } as const]

export const markdownRemarkPlugins = [remarkGfm, remarkMath]
export const markdownRehypePlugins: Pluggable[] = [
  rehypeRaw,
  [rehypeSanitize, mdSanitizeSchema] as Pluggable,
  rehypeKatexSafe,
]

/**
 * rehype plugin: wrap each non-whitespace character in a `<span class="md-char">` so
 * a CSS animation can fade each character in individually. Skips code / pre / math
 * subtrees (and the overlay-stream-marker) to avoid breaking their rendering.
 *
 * Runs during streaming in token mode only. React reconciles existing spans by
 * position, so newly-arrived characters are the only ones that re-run the fade-in
 * animation; already-mounted spans stay solid.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HastNode = any
const CHAR_WRAP_SKIP_TAGS = new Set([
  'code',
  'pre',
  'style',
  'script',
  'math',
  'mi',
  'mn',
  'mo',
  'mrow',
  'msub',
  'msup',
  'mfrac',
  'mtext',
  'semantics',
  'annotation',
])

function nodeHasKatexClass(node: HastNode): boolean {
  const cls = node?.properties?.className
  if (!cls) return false
  const arr = Array.isArray(cls) ? cls : typeof cls === 'string' ? cls.split(/\s+/) : []
  for (const c of arr) {
    if (typeof c !== 'string') continue
    if (c === 'katex' || c === 'mathml' || c.startsWith('katex-')) return true
  }
  return false
}

function nodeIsStreamMarker(node: HastNode): boolean {
  const cls = node?.properties?.className
  if (!cls) return false
  const arr = Array.isArray(cls) ? cls : typeof cls === 'string' ? cls.split(/\s+/) : []
  return arr.includes('overlay-stream-marker')
}

function splitTextForCharFade(text: string): HastNode[] {
  if (!text) return []
  const out: HastNode[] = []
  let wsBuf = ''
  for (const ch of text) {
    if (/\s/.test(ch)) {
      wsBuf += ch
      continue
    }
    if (wsBuf) {
      out.push({ type: 'text', value: wsBuf })
      wsBuf = ''
    }
    out.push({
      type: 'element',
      tagName: 'span',
      properties: { className: ['md-char'] },
      children: [{ type: 'text', value: ch }],
    })
  }
  if (wsBuf) out.push({ type: 'text', value: wsBuf })
  return out
}

function rehypeWrapStreamChars() {
  return (tree: HastNode) => {
    function walk(node: HastNode) {
      if (!node || !Array.isArray(node.children)) return
      const next: HastNode[] = []
      for (const child of node.children) {
        if (child.type === 'text') {
          const parts = splitTextForCharFade(child.value)
          for (const p of parts) next.push(p)
        } else if (child.type === 'element') {
          const tag = child.tagName
          if (CHAR_WRAP_SKIP_TAGS.has(tag) || nodeHasKatexClass(child) || nodeIsStreamMarker(child)) {
            next.push(child)
          } else {
            walk(child)
            next.push(child)
          }
        } else {
          next.push(child)
        }
      }
      node.children = next
    }
    walk(tree)
  }
}

export const markdownRehypePluginsStreaming: Pluggable[] = [
  rehypeRaw,
  rehypeWrapStreamChars as Pluggable,
  [rehypeSanitize, mdSanitizeSchema] as Pluggable,
  rehypeKatexSafe,
]

/**
 * Reveal `targetText` one character at a time at a steady rate so tokens that
 * arrive from the server in chunks of 5-20 chars get visually dripped in as
 * individual characters instead of popping in as blocks.
 *
 * Base rate is ~80 chars/sec; if we fall behind the target, the rate ramps up so
 * we catch up within ~1 second even on long bursts. When `isStreaming` flips to
 * false (or the hook is disabled), we snap to the full text immediately.
 */
