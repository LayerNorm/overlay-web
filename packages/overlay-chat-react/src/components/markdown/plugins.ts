import rehypeRaw from 'rehype-raw'
import rehypeSanitize,{ defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { createMathPlugin } from '@streamdown/math'
import type { Pluggable } from 'unified'

type MarkdownNode = {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

const FILE_CONTENT_PATH = String.raw`/api/v1/files/(?:[A-Za-z0-9._~!()*'-]|%[\da-fA-F]{2})+/content`
const fileContentHref = new RegExp(`^${FILE_CONTENT_PATH}$`)

export function isFileContentHref(value: string): boolean {
  return fileContentHref.test(value)
}

function remarkFileDownloadLinks() {
  return function transform(tree: MarkdownNode) {
    visit(tree)

    function visit(parent: MarkdownNode) {
      if (!parent.children || parent.type === 'link' || parent.type === 'linkReference') return
      for (let index = 0; index < parent.children.length; index++) {
        const node = parent.children[index]!
        if (node.type === 'inlineCode' && node.value && isFileContentHref(node.value)) {
          parent.children[index] = { type: 'link', url: node.value, children: [node] }
          continue
        }
        if (node.type !== 'text' || !node.value) {
          visit(node)
          continue
        }
        const replacements: MarkdownNode[] = []
        const pattern = new RegExp(`(^|[\\s(\\[])(${FILE_CONTENT_PATH})(?=$|[\\s).,!;:\\]])`, 'g')
        let end = 0
        for (const match of node.value.matchAll(pattern)) {
          const start = match.index + match[1]!.length
          const url = match[2]!
          if (start > end) replacements.push({ type: 'text', value: node.value.slice(end, start) })
          replacements.push({ type: 'link', url, children: [{ type: 'text', value: url }] })
          end = start + url.length
        }
        if (replacements.length === 0) continue
        if (end < node.value.length) replacements.push({ type: 'text', value: node.value.slice(end) })
        parent.children.splice(index, 1, ...replacements)
        index += replacements.length - 1
      }
    }
  }
}

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

/** Streamdown pipeline: math comes from the plugin (remark-math + KaTeX), so it is not listed here. */
export const streamdownRemarkPlugins: Pluggable[] = [remarkGfm, remarkFileDownloadLinks]
export const streamdownRehypePlugins: Pluggable[] = [rehypeRaw, [rehypeSanitize, mdSanitizeSchema] as Pluggable]
export const streamdownMath = createMathPlugin({ singleDollarTextMath: true })
