/**
 * Minimal HTML-to-text reduction for web knowledge sources.
 *
 * Deliberately dependency-free and conservative: it strips non-content elements,
 * keeps block structure as newlines, and decodes only the standard named
 * entities. It is not a full readability implementation — the goal is text good
 * enough to chunk and embed, with the page title preserved.
 */

export type ExtractedHtmlText = {
  text: string
  title?: string
}

/** Elements whose contents are never readable page text. */
const STRIPPED_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'head',
  'nav',
  'footer',
  'form',
]

/** Elements that should force a line break so sentences do not run together. */
const BLOCK_ELEMENTS = [
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hr', 'li', 'main', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'ul',
]

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  '#39': "'",
}

export function extractReadableText(html: string): ExtractedHtmlText {
  if (!html.trim()) return { text: '' }
  const title = readTitle(html)
  let working = html

  // Comments first, so a commented-out <script> cannot confuse the strip pass.
  working = working.replace(/<!--[\s\S]*?-->/g, ' ')
  for (const element of STRIPPED_ELEMENTS) {
    working = working.replace(
      new RegExp(`<${element}\\b[^>]*>[\\s\\S]*?</${element}\\s*>`, 'gi'),
      ' ',
    )
    // Unclosed or self-closing occurrences.
    working = working.replace(new RegExp(`<${element}\\b[^>]*/?>`, 'gi'), ' ')
  }
  for (const element of BLOCK_ELEMENTS) {
    working = working.replace(new RegExp(`</?${element}\\b[^>]*>`, 'gi'), '\n')
  }
  working = working.replace(/<[^>]+>/g, ' ')
  working = decodeEntities(working)
  return { text: normalizeWhitespace(working), title }
}

function readTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)
  if (!match) return undefined
  const title = normalizeWhitespace(decodeEntities(match[1]!.replace(/<[^>]+>/g, ' ')))
    .replace(/\n+/g, ' ')
    .trim()
  return title || undefined
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower in NAMED_ENTITIES) return NAMED_ENTITIES[lower]!
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16)
      return Number.isFinite(code) ? safeFromCodePoint(code, match) : match
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(code) ? safeFromCodePoint(code, match) : match
    }
    return match
  })
}

function safeFromCodePoint(code: number, fallback: string): string {
  if (code <= 0 || code > 0x10ffff) return fallback
  try {
    return String.fromCodePoint(code)
  } catch (_error) {
    return fallback
  }
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
