/**
 * DOM Sanitizer
 * Strips noise from raw page body text to improve agent comprehension.
 * Runs in the Node/Electron main process on text already extracted from the page.
 */

// Tag and class patterns that should be stripped
const NOISE_CLASS_PATTERNS = [
  /\bad[-_]?(?:unit|banner|slot|container|wrapper|block|box|label|text)\b/i,
  /\bspons(?:or(?:ed)?)?[-_]/i,
  /\btracking[-_]?pixel\b/i,
  /\bcookie[-_]?(?:banner|notice|consent|bar)\b/i,
  /\bpopup\b/i,
  /\bmodal[-_]?overlay\b/i,
  /\bnewsletter[-_]?(?:signup|subscribe|popup)\b/i,
  /\bsocial[-_]?share\b/i,
  /\bcomment[-_]?(?:section|form)\b/i
]

// Inline snippets that indicate repeated/boilerplate content
const BOILERPLATE_PATTERNS = [
  /accept\s+(?:all\s+)?cookies/i,
  /we\s+use\s+cookies/i,
  /privacy\s+policy/i,
  /terms\s+of\s+(?:service|use)/i,
  /©\s*\d{4}/,
  /all\s+rights\s+reserved/i
]

/**
 * Collapse excessive whitespace and blank lines in a string.
 */
function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Remove lines that are clearly boilerplate noise (cookie notices, copyright footers, etc.).
 */
function removeBoilerplateLines(text: string): string {
  const lines = text.split('\n')
  const filtered = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) return true // keep blank lines for structure
    return !BOILERPLATE_PATTERNS.some((p) => p.test(trimmed))
  })
  return filtered.join('\n')
}

/**
 * Check whether a CSS class list string looks like an ad / tracking element.
 */
export function isNoiseClass(classList: string): boolean {
  return NOISE_CLASS_PATTERNS.some((p) => p.test(classList))
}

/**
 * Sanitize raw body text extracted from a web page:
 * 1. Collapse whitespace
 * 2. Strip boilerplate/cookie/ad lines
 * 3. Truncate to the requested character limit
 */
export function sanitizeBodyText(raw: string, maxChars = 8000): string {
  let result = collapseWhitespace(raw)
  result = removeBoilerplateLines(result)
  return result.slice(0, maxChars)
}

/**
 * Build the best CSS selector for an element, prioritising stable identifiers.
 *
 * Priority:
 *   1. #id
 *   2. [data-testid="..."]
 *   3. [data-cy="..."]
 *   4. [aria-label="..."]  (when unique enough)
 *   5. tag + first meaningful class(es)
 *   6. tag + nth-child fallback
 */
export function buildStableSelector(
  id: string,
  tagName: string,
  classList: string,
  dataTestId: string,
  dataCy: string,
  ariaLabel: string,
  nthChild?: number
): string {
  if (id) return `#${CSS_ESCAPE(id)}`
  if (dataTestId) return `[data-testid="${dataTestId}"]`
  if (dataCy) return `[data-cy="${dataCy}"]`

  const tag = tagName.toLowerCase()

  // aria-label as selector for interactive elements where it's descriptive
  if (ariaLabel && ariaLabel.length > 2 && ariaLabel.length < 60) {
    return `${tag}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`
  }

  // Class-based fallback
  const classes = classList
    .split(/\s+/)
    .filter((c) => c.length > 0 && !isNoiseClass(c))
    .slice(0, 2)
    .map((c) => `.${CSS_ESCAPE(c)}`)
    .join('')

  if (classes) {
    const base = `${tag}${classes}`
    return nthChild ? `${base}:nth-child(${nthChild})` : base
  }

  return nthChild ? `${tag}:nth-child(${nthChild})` : tag
}

/** Minimal CSS.escape polyfill for use in the main process (no DOM). */
function CSS_ESCAPE(value: string): string {
  return value.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
}
