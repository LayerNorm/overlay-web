/**
 * Rewrites the sanitized inline HTML produced by
 * `@overlay/app-core/note-markdown` (the legacy TipTap canonical form) into
 * markup BlockNote's default parse rules understand. String-level transforms
 * only: everything here is idempotent and only touches known legacy patterns.
 */

import { iconForAlertTag } from './blocks'

const MARK_OPEN_REGEX = /<mark[^>]*>/gi
const ATTR_COLOR_REGEX = /data-color="([^"]+)"/i
const ATTR_STYLE_REGEX = /style="([^"]*)"/i
const INLINE_MATH_REGEX =
  /<span[^>]*data-type="inline-math"[^>]*data-latex="([^"]*)"[^>]*>([\s\S]*?)<\/span>/gi
const BLOCK_MATH_REGEX =
  /<div[^>]*data-type="block-math"[^>]*data-latex="([^"]*)"[^>]*>([\s\S]*?)<\/div>/gi
const BLOCK_MATH_NODATA_REGEX =
  /<div[^>]*data-type="block-math"[^>]*>([\s\S]*?)<\/div>/gi
const YOUTUBE_WRAPPER_REGEX =
  /<div[^>]*data-youtube-video[^>]*>\s*<iframe([^>]*)src="([^"]+)"([^>]*)>\s*<\/iframe>\s*<\/div>/gi
const TASK_ITEM_REGEX =
  /<li([^>]*)data-type="taskItem"([^>]*)data-checked="(true|false)"([^>]*)>/gi

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Legacy HTML -> HTML the BlockNote parser understands. */
export function legacyHtmlToBlocksHtml(html: string): string {
  let out = html

  // Colored <mark> -> <span style="background-color:..."> so BlockNote maps it
  // to the backgroundColor style instead of dropping the color. Marks without
  // a data-color become plain <span>s.
  out = out.replace(MARK_OPEN_REGEX, (tag) => {
    const color = ATTR_COLOR_REGEX.exec(tag)?.[1]
    if (!color) return `<span${tag.slice(5, -1)}>`
    const before = tag.slice(5, tag.toLowerCase().indexOf('data-color'))
    const style = ATTR_STYLE_REGEX.exec(tag)?.[1] ?? ''
    const bg = /background-color:\s*([^;"']+)/i.exec(style)?.[1]?.trim()
    return `<span${before} style="background-color: ${bg ?? color}">`
  })
  out = out.replace(/<\/mark>/gi, '</span>')

  // Inline + block math -> MathML with a TeX annotation, which the math
  // specs parse natively.
  const toMathMl = (display: 'inline' | 'block', latex: string) =>
    `<math display="${display}"><annotation encoding="application/x-tex">${escapeHtml(
      latex,
    )}</annotation></math>`
  out = out.replace(INLINE_MATH_REGEX, (_m, latex: string, inner: string) =>
    toMathMl('inline', latex || inner || ''),
  )
  out = out.replace(BLOCK_MATH_REGEX, (_m, latex: string, inner: string) =>
    `<p>${toMathMl('block', latex || inner || '')}</p>`,
  )
  out = out.replace(
    BLOCK_MATH_NODATA_REGEX,
    (_m, inner: string) => `<p>${toMathMl('block', inner || '')}</p>`,
  )

  // Legacy YouTube embeds stored as <div data-youtube-video><iframe> become
  // embed blocks (parsed via <figure data-embed-url>).
  out = out.replace(
    YOUTUBE_WRAPPER_REGEX,
    (_m, _pre: string, src: string) =>
      `<figure data-embed-url="${src}"></figure>`,
  )

  // Standalone youtube embed iframes (allowed by the sanitizer) -> embed.
  out = out.replace(
    /<iframe([^>]*)src="(https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/[^"]+)"([^>]*)>\s*<\/iframe>/gi,
    (_m, _a: string, src: string) =>
      `<figure data-embed-url="${src}"></figure>`,
  )

  // GFM alert blockquotes (`> [!NOTE] text`) -> callout blocks. Only
  // single-paragraph alerts map cleanly onto inline callout content.
  out = out.replace(
    /<blockquote[^>]*>\s*<p[^>]*>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO)\]\s*([\s\S]*?)<\/p>\s*<\/blockquote>/gi,
    (_m, tag: string, inner: string) =>
      `<div data-callout data-callout-icon="${iconForAlertTag(tag)}">${inner.trim()}</div>`,
  )

  // Sanitized task items carry data-type/data-checked but no <input>; inject a
  // checkbox so checkListItem's checkbox rule wins over bulletListItem's `li`.
  out = out.replace(
    TASK_ITEM_REGEX,
    (_m, _a: string, _b: string, checked: string) =>
      `<li><input type="checkbox"${checked === 'true' ? ' checked' : ''}>`,
  )

  // <sub>/<sup> have no default style spec; unwrap to keep the text.
  out = out.replace(/<(\/?)(sub|sup)>/gi, '<$1span>')

  return out
}
