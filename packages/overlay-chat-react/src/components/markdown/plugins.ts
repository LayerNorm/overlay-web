import rehypeRaw from 'rehype-raw'
import rehypeSanitize,{ defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { createMathPlugin } from '@streamdown/math'
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

/** Streamdown pipeline: math comes from the plugin (remark-math + KaTeX), so it is not listed here. */
export const streamdownRemarkPlugins: Pluggable[] = [remarkGfm]
export const streamdownRehypePlugins: Pluggable[] = [rehypeRaw, [rehypeSanitize, mdSanitizeSchema] as Pluggable]
export const streamdownMath = createMathPlugin({ singleDollarTextMath: true })
