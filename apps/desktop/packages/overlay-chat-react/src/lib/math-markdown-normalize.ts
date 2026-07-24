/**
 * Portable copy of the app's `src/shared/markdown/math-markdown-normalize.ts` so the
 * standalone @overlay/chat-react renderer can defuse currency/pseudo-math before
 * remark-math runs. Keep the two in sync.
 *
 * Post-process assistant markdown so KaTeX (remark-math) sees math. Weak models often use
 * `[ ... ]` or `( ... )` around TeX instead of `$$...$$`, which does not render.
 *
 * Uses balanced delimiter scanning so inner `\right]`, `\left[`, nested `(`, etc. do not
 * terminate the span too early (the old regex did).
 */

const TEX_COMMAND = /\\[a-zA-Z@]+/
const BIG_O_ATOM = /O\([^)\n]{1,80}\)/
const BIG_O_ATOM_GLOBAL = /O\([^)\n]{1,80}\)/g
const DISPLAY_TEX_COMMAND = /\\(?:begin|end|frac|sum|prod|int|lim|left|right|quad|text|cdots|vdots|ddots|mathcal)\b/

function findMatchingSquareBracketEnd(s: string, openIdx: number): number {
  if (s[openIdx] !== '[') return -1
  let depth = 1
  let i = openIdx + 1
  while (i < s.length && depth > 0) {
    const c = s[i]
    if (c === '[') depth++
    else if (c === ']') depth--
    i++
  }
  return depth === 0 ? i - 1 : -1
}

function findMatchingParenEnd(s: string, openIdx: number): number {
  if (s[openIdx] !== '(') return -1
  let depth = 1
  let i = openIdx + 1
  while (i < s.length && depth > 0) {
    const c = s[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    i++
  }
  return depth === 0 ? i - 1 : -1
}

/** True if `pos` is inside an odd number of `$$` pairs in `s` (naive — counts all `$$` in prefix). */
function isInsideDoubleDollarBlock(s: string, pos: number): boolean {
  const before = s.slice(0, pos)
  const n = (before.match(/\$\$/g) ?? []).length
  return n % 2 === 1
}

/**
 * `[ \\begin{aligned} ... \\right] ... \\end{aligned} ]` and similar — wrap as `$$...$$` when
 * inner text clearly contains TeX commands.
 */
export function normalizeBracketDelimitedLatex(text: string): string {
  if (!text.includes('[') || !text.includes('\\')) return text

  const parts: string[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('[', i)
    if (open < 0) {
      parts.push(text.slice(i))
      break
    }
    parts.push(text.slice(i, open))
    // Skip `\[ … \]` — keep both `\` and `[`.
    if (open > 0 && text[open - 1] === '\\') {
      parts.push(text.slice(open, open + 1))
      i = open + 1
      continue
    }
    if (isInsideDoubleDollarBlock(text, open)) {
      parts.push('[')
      i = open + 1
      continue
    }

    const close = findMatchingSquareBracketEnd(text, open)
    if (close < 0) {
      parts.push(text.slice(open))
      break
    }

    const inner = text.slice(open + 1, close).trim()
    if (inner.length >= 2 && TEX_COMMAND.test(inner)) {
      parts.push(`$$${inner}$$`)
    } else {
      parts.push(text.slice(open, close + 1))
    }
    i = close + 1
  }
  return parts.join('')
}

/**
 * `(\rho)`, `(\\Re(s)=\\frac12)` — models use parens as fake inline math delimiters.
 * Only rewrites when parentheses are balanced and inner looks like TeX.
 */
export function normalizeParenDelimitedLatex(text: string): string {
  if (!text.includes('(') || !text.includes('\\')) return text

  const parts: string[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('(', i)
    if (open < 0) {
      parts.push(text.slice(i))
      break
    }
    parts.push(text.slice(i, open))
    // Skip `\(` … `\)` — keep `\(` intact.
    if (open > 0 && text[open - 1] === '\\') {
      parts.push(text.slice(open, open + 1))
      i = open + 1
      continue
    }
    if (isInsideDoubleDollarBlock(text, open)) {
      parts.push('(')
      i = open + 1
      continue
    }

    const close = findMatchingParenEnd(text, open)
    if (close < 0) {
      parts.push(text.slice(open))
      break
    }

    const inner = text.slice(open + 1, close).trim()
    const innerLen = close - open - 1
    // Skip very long spans (likely prose); skip if no TeX command
    if (innerLen > 0 && innerLen < 800 && TEX_COMMAND.test(inner)) {
      parts.push(`$$${inner}$$`)
    } else {
      parts.push(text.slice(open, close + 1))
    }
    i = close + 1
  }
  return parts.join('')
}

/** Run bracket then paren so nested structures and `$$` output stay consistent. */
export function normalizeLatexDelimiters(text: string): string {
  return normalizeEscapedLatexDelimiters(
    normalizeParenDelimitedLatex(normalizeBracketDelimitedLatex(text)),
  )
}

/**
 * Accept common TeX delimiters even when the model ignores our prompt. `\(...\)` is
 * inline math; `\[...\]` is display math.
 */
export function normalizeEscapedLatexDelimiters(text: string): string {
  if (!text.includes('\\')) return text
  return text
    .replace(/\\\[((?:.|\n)*?)\\\]/g, (_match, inner: string) => `\n\n$$\n${inner.trim()}\n$$\n\n`)
    .replace(/\\\(([^()\n]{1,500}?)\\\)/g, (_match, inner: string) => `$${inner.trim()}$`)
}

/**
 * remark-math only uses true display (block) math when the opening `$$` is in the
 * "flow" position (see micromark-extension-math): `$$\n...\n$$`. A heavy matrix on one
 * line mid-paragraph (`$$\begin{bmatrix}...\end{bmatrix}$$`) is parsed as *inline* math,
 * which is smaller, easier to break, and more likely to hit KaTeX edge cases.
 *
 * Rewrite those spans into flow fences so rehype-katex gets `displayMode: true`.
 */
export function promoteHeavyInlineMathToFlowBlocks(text: string): string {
  let i = 0
  let out = ''
  let inFence = false

  while (i < text.length) {
    if (!inFence && text.startsWith('```', i)) {
      inFence = true
      out += '```'
      i += 3
      continue
    }
    if (inFence) {
      if (text.startsWith('```', i)) {
        inFence = false
        out += '```'
        i += 3
      } else {
        out += text[i]!
        i += 1
      }
      continue
    }

    if (text[i] === '$' && text[i + 1] === '$') {
      const close = text.indexOf('$$', i + 2)
      if (close < 0) {
        out += text.slice(i)
        break
      }
      const inner = text.slice(i + 2, close)
      const trimmed = inner.trim()

      const lineStart = text.lastIndexOf('\n', i - 1) + 1
      const beforeOnLine = text.slice(lineStart, i)
      const opensAtLineStart = /^\s*$/.test(beforeOnLine)

      // Already a normal flow block: `$$\n...\n$$` with nothing else on the opening line.
      const looksLikeFlowBlock = opensAtLineStart && inner.startsWith('\n')

      const backslashRuns = trimmed.match(/\\\\/g) ?? []
      const heavy =
        /\\begin\{/.test(trimmed) ||
        backslashRuns.length >= 2 ||
        trimmed.length > 96

      if (heavy && !looksLikeFlowBlock) {
        out += `\n\n$$\n${trimmed}\n$$\n\n`
      } else {
        out += text.slice(i, close + 2)
      }
      i = close + 2
      continue
    }

    out += text[i]!
    i += 1
  }

  return out
}

/**
 * Older prompts asked models to use `$$...$$` inline. That works until one delimiter
 * arrives late or is omitted, at which point remark-math can feed a whole paragraph to
 * KaTeX. Normalize compact same-line double-dollar spans to standard inline `$...$`,
 * keep heavy spans as display blocks, and defuse obvious stray delimiters around short
 * math atoms so one bad token cannot turn the rest of the message red.
 */
export function normalizeDoubleDollarMath(text: string): string {
  return rewriteBalancedDoubleDollarMath(
    repairStrayInlineDoubleDollarOpeners(repairStrayInlineDoubleDollarClosers(text)),
  )
}

function rewriteBalancedDoubleDollarMath(text: string): string {
  let i = 0
  let out = ''
  let inFence = false

  while (i < text.length) {
    if (!inFence && text.startsWith('```', i)) {
      inFence = true
      out += '```'
      i += 3
      continue
    }
    if (inFence) {
      if (text.startsWith('```', i)) {
        inFence = false
        out += '```'
        i += 3
      } else {
        out += text[i]!
        i += 1
      }
      continue
    }

    if (text[i] === '$' && text[i + 1] === '$') {
      const close = text.indexOf('$$', i + 2)
      if (close < 0) {
        out += text.slice(i)
        break
      }

      const inner = text.slice(i + 2, close)
      const trimmed = inner.trim()
      const lineStart = text.lastIndexOf('\n', i - 1) + 1
      const beforeOnLine = text.slice(lineStart, i)
      const opensAtLineStart = /^\s*$/.test(beforeOnLine)
      const looksLikeFlowBlock = opensAtLineStart && inner.startsWith('\n')

      if (looksLikeFlowBlock) {
        out += text.slice(i, close + 2)
      } else if (isHeavyMath(trimmed)) {
        out += `\n\n$$\n${trimmed}\n$$\n\n`
      } else if (looksLikeMath(trimmed) && !looksLikeProse(trimmed)) {
        out += `$${trimmed}$`
      } else {
        // Bad pair, usually `...math$$ prose ... $$\Sigma`. Leave literal delimiters
        // escaped so markdown/KaTeX cannot consume the surrounding prose.
        out += `\\$\\$${inner}\\$\\$`
      }
      i = close + 2
      continue
    }

    out += text[i]!
    i += 1
  }

  return out
}

function repairStrayInlineDoubleDollarOpeners(text: string): string {
  if (!text.includes('$$')) return text
  return text.replace(
    /\$\$(\\[A-Za-z@]+(?:\{[^{}\n]{1,120}\})?(?:\^[^\s$.,;:)]+|_[^\s$.,;:)]+)?|[A-Za-zΑ-Ωα-ω](?:[_^][A-Za-z0-9]+)?)(?=([\s,.;:)]|$))/g,
    (match, atom: string, _boundary: string, offset: number, full: string) => {
      const nextClose = full.indexOf('$$', offset + 2)
      const nextNewline = full.indexOf('\n', offset + 2)
      if (nextClose >= 0 && (nextNewline < 0 || nextClose < nextNewline)) return match
      return `$${atom}$`
    },
  )
}

function repairStrayInlineDoubleDollarClosers(text: string): string {
  if (!text.includes('$$')) return text
  return text.replace(
    /((?:\\[A-Za-z@]+|[A-Za-z0-9Α-Ωα-ω+\-=^_{}().,\\ ]){1,120}(?:\\[A-Za-z@]+|O\([^)\n]{1,80}\))(?:[A-Za-z0-9Α-Ωα-ω+\-=^_{}().,\\ ]){0,80})\$\$(?=\s+[a-zA-Z])/g,
    (match, atom: string, offset: number, full: string) => {
      const delimiterOffset = offset + atom.length
      if (countDoubleDollarDelims(full.slice(0, delimiterOffset)) % 2 === 1) return match
      return wrapTrailingMathAtom(atom)
    },
  )
}

function countDoubleDollarDelims(text: string): number {
  return text.match(/\$\$/g)?.length ?? 0
}

function wrapTrailingMathAtom(atom: string): string {
  const bigOMatches = [...atom.matchAll(BIG_O_ATOM_GLOBAL)]
  const bigO = bigOMatches.at(-1)
  let start = bigO?.index ?? -1

  if (start < 0) {
    const commandIdx = atom.search(TEX_COMMAND)
    if (commandIdx >= 0) {
      start = commandIdx
      let j = commandIdx - 1
      while (j >= 0 && /\s/.test(atom[j]!)) j--
      while (j >= 0 && /[A-Za-z0-9Α-Ωα-ω.()+\-=^_{}]/.test(atom[j]!)) j--
      start = j + 1
    }
  }

  if (start <= 0) return `$${atom.trim()}$`
  const prefix = atom.slice(0, start)
  const math = atom.slice(start).trim()
  return `${prefix}$${math}$`
}

function isHeavyMath(s: string): boolean {
  const backslashRuns = s.match(/\\\\/g) ?? []
  return /\\begin\{/.test(s) || backslashRuns.length >= 2 || s.length > 96
}

function looksLikeMath(s: string): boolean {
  if (
    TEX_COMMAND.test(s) ||
    TEX_HINT.test(s) ||
    BIG_O_ATOM.test(s) ||
    looksLikeMathVariable(s)
  ) {
    return true
  }
  // Detect compact numeric/symbolic equations. Be stricter with slash/hyphen so
  // prose like `$0.25 / seat` or `$2-4` is not mistaken for math.
  const hasEquation =
    /[A-Za-z0-9)]\s*[=+×*]\s*[A-Za-z0-9(]/.test(s) ||
    /[A-Za-z)]\s*[-]\s*[A-Za-z(]/.test(s) ||
    /[A-Za-z)]-[A-Za-z(]/.test(s) ||
    /[A-Za-z0-9)]\/[A-Za-z0-9(]/.test(s)
  return hasEquation
}

function looksLikeProse(s: string): boolean {
  const words = s.match(/[A-Za-z]{3,}/g) ?? []
  const texCommands = s.match(/\\[A-Za-z@]+/g) ?? []
  return words.length - texCommands.length >= 3
}

/**
 * Recover common raw TeX lines when a model omits math delimiters entirely. This is
 * intentionally line-oriented: it catches formula lines without swallowing a whole
 * explanatory paragraph into KaTeX.
 */
export function normalizeBareLatexLines(text: string): string {
  if (!/[\\_^]/.test(text)) return text

  const lines = text.split('\n')
  const out: string[] = []
  let inFence = false
  let inDisplayMath = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      inFence = !inFence
      out.push(line)
      continue
    }

    if (!inFence && trimmed === '$$') {
      inDisplayMath = !inDisplayMath
      out.push(line)
      continue
    }

    if (inFence || inDisplayMath) {
      out.push(line)
      continue
    }

    if (trimmed.startsWith('|')) {
      const promoted = promoteBareLatexInTableRow(line)
      if (promoted !== line) {
        out.push(promoted)
        continue
      }
      out.push(line)
      continue
    }

    if (!shouldPromoteBareLatexLine(line)) {
      out.push(line)
      continue
    }

    out.push(...promoteBareLatexLine(line))
  }

  return out.join('\n')
}

function shouldPromoteBareLatexLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('|')) return false
  if (trimmed.includes('```') || trimmed.includes('$$')) return false

  const withoutInlineMath = stripInlineMathSpans(trimmed)
  if (!/[\\_^]/.test(withoutInlineMath)) return false

  const hasTexCommand = TEX_COMMAND.test(withoutInlineMath)
  const hasDisplayCommand = DISPLAY_TEX_COMMAND.test(withoutInlineMath)
  const hasSubscriptEquation =
    /(?:^|[\s(:;])(?:[A-Za-zΑ-Ωα-ω]|\\[A-Za-z]+)_\{?[^=\s;)]{1,40}\}?\s*=/.test(withoutInlineMath)
  const hasCommandEquation = /\\[A-Za-z@]+(?:\{[^}\n]*\})?\s*=/.test(withoutInlineMath)
  const hasEquationAfterCommand = /=\s*\\[\$A-Za-z@]+(?:\{[^}\n]*\})?/.test(withoutInlineMath)
  const hasMatrix = /\\begin\{[a-zA-Z*]+matrix\}/.test(withoutInlineMath)

  return (
    hasMatrix ||
    hasDisplayCommand ||
    hasSubscriptEquation ||
    (hasTexCommand && (hasCommandEquation || hasEquationAfterCommand))
  )
}

function stripInlineMathSpans(text: string): string {
  return text.replace(/(?<![\\$])\$(?!\$)[^$\n]{1,400}?\$(?!\$)/g, ' ')
}

function promoteBareLatexLine(line: string): string[] {
  const start = findBareLatexStart(line)
  let math = line.slice(start < 0 ? 0 : start).trim()
  // Strip a stray trailing closing $ so the display fence doesn't include a dangling
  // delimiter left over from a malformed model attempt at inline math.
  if (math.endsWith('$') && !math.endsWith('\\$')) {
    math = math.slice(0, -1)
  }
  math = normalizeLatexBody(math)
  if (start <= 0) {
    return ['', '$$', math, '$$', '']
  }

  const prefix = line.slice(0, start).trimEnd()
  if (!prefix) return ['', '$$', math, '$$', '']

  return [prefix, '', '$$', math, '$$', '']
}

/**
 * Promote bare LaTeX inside markdown table cells. Table rows must stay inline,
 * so we wrap only the cell content in `$...$` rather than using display fences.
 */
function promoteBareLatexInTableRow(line: string): string {
  const cells = line.split('|')
  const promoted = cells.map((cell, index) => {
    // First and last cells are empty because markdown table rows start/end with `|`.
    if (index === 0 || index === cells.length - 1) return cell
    const trimmed = cell.trim()
    if (!trimmed || !shouldPromoteBareLatexLine(trimmed)) return cell
    const start = findBareLatexStart(trimmed)
    const prefix = start > 0 ? trimmed.slice(0, start).trimEnd() : ''
    let math = start > 0 ? trimmed.slice(start).trim() : trimmed
    // If the bare math already ends with a stray closing $, pair it with a leading $.
    if (math.endsWith('$') && !math.endsWith('\\$')) {
      math = math.slice(0, -1)
    }
    const wrapped = `$${normalizeLatexBody(math)}$`
    if (prefix) {
      return ` ${prefix} ${wrapped} `
    }
    return ` ${wrapped} `
  })
  return promoted.join('|')
}

function findBareLatexStart(line: string): number {
  const candidates: number[] = []
  const equation = line.search(/(?:[A-Za-zΑ-Ωα-ω]|\\[A-Za-z]+)(?:_\{?[^=\s;)]{1,40}\}?|\^\{?[^=\s;)]{1,40}\}?)*\s*=/)
  if (equation >= 0) candidates.push(equation)

  const begin = line.search(/\\begin\{/)
  if (begin >= 0) {
    const before = line.slice(0, begin)
    const boundary = Math.max(before.lastIndexOf(':'), before.lastIndexOf('.'), before.lastIndexOf(';'))
    candidates.push(boundary >= 0 ? boundary + 1 : 0)
  }

  const command = line.search(DISPLAY_TEX_COMMAND)
  if (command >= 0) candidates.push(command)

  if (candidates.length === 0) return 0
  return Math.max(0, Math.min(...candidates))
}

function normalizeLatexBody(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    // Models often stream a single slash between matrix rows. KaTeX needs `\\`.
    .replace(/(?<!\\)\\\s+(?=(?:[A-Za-zΑ-Ωα-ω]|\d|\\[a-zA-Z]+|[.&]))/g, '\\\\ ')
    .trim()
}

/**
 * Models constantly emit prose with currency amounts like `$4,077.71 in deposits and
 * $8,080.64 in outflows`. remark-math then pairs the two `$` as inline math, italicizes
 * the prose between them, and turns plain numbers into `4,077.71` etc. Defuse this by
 * walking same-line `$...$` candidates and escaping the delimiters whenever the inner
 * span has no TeX hints (no `\command`, no `^`, `_`, `{`, `}`) — a clear sign it was
 * accidentally wrapped prose, not real math.
 *
 * Code fences and inline code are skipped so we never mutate user-visible code.
 */
export function escapeProsePseudoMath(text: string): string {
  if (!text.includes('$')) return text
  const codePattern = /(```[\s\S]*?```|`[^`\n]+`)/g
  const segments: string[] = []
  let lastEnd = 0
  for (const match of text.matchAll(codePattern)) {
    const start = match.index ?? 0
    if (start > lastEnd) segments.push(processProseRegion(text.slice(lastEnd, start)))
    segments.push(match[0])
    lastEnd = start + match[0].length
  }
  if (lastEnd < text.length) segments.push(processProseRegion(text.slice(lastEnd)))
  return segments.join('')
}

/** Render common bare Big-O notation without asking models to spell every `$` correctly. */
export function normalizeBareBigONotation(text: string): string {
  if (!text.includes('O(')) return text
  const protectedPattern = /(```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g
  const segments: string[] = []
  let lastEnd = 0
  for (const match of text.matchAll(protectedPattern)) {
    const start = match.index ?? 0
    if (start > lastEnd) segments.push(wrapBareBigO(text.slice(lastEnd, start)))
    segments.push(match[0])
    lastEnd = start + match[0].length
  }
  if (lastEnd < text.length) segments.push(wrapBareBigO(text.slice(lastEnd)))
  return segments.join('')
}

function wrapBareBigO(text: string): string {
  return text.replace(
    /(^|[^A-Za-z0-9$])((?:O|\\mathcal\{O\})\([^)\n]{1,80}\))(?![A-Za-z0-9$])/g,
    (_match, prefix: string, atom: string) => `${prefix}$${atom}$`,
  )
}

const TEX_HINT = /[\\^_{}]/

// Single-letter identifiers (x, L, P, α, β …) are valid inline math even without
// explicit TeX commands. Preserving them prevents `**$L$**` from being mangled into
// `**\$L\$**` which remark-math then treats as literal text inside bold.
const MATH_VARIABLE = /^[A-Za-zΑ-Ωα-ω]$|^(?:dx|dy|dz|dt|d[A-Za-z]|Δx|Δy|Δt|sin|cos|tan|sec|csc|cot|log|ln|exp|lim|max|min|gcd|lcm|det|tr|rank|ker|dim|deg|arg|Res|Pr|E|Var|Cov|Bias|pdf|cdf)$/

function looksLikeMathVariable(inner: string): boolean {
  const trimmed = inner.trim()
  if (TEX_HINT.test(trimmed)) return true
  if (MATH_VARIABLE.test(trimmed)) return true
  return false
}

function processProseRegion(text: string): string {
  // Same-line `$...$` (not part of `$$` and not `\$`-escaped) with a bounded body.
  // The 400-char cap prevents pathological cross-paragraph matches when prose contains
  // many stray `$` characters on a single very long line.
  return text.replace(
    /(?<![\\$])\$(?!\$)([^$\n]{1,400}?)\$(?!\$)/g,
    (match, inner: string, offset: number, full: string) => {
      // If the span contains any TeX hint, keep it as real math even when it also
      // contains currency-like numbers. Models often write finance examples like
      // `$1.1000 \times 100{,}000 = \$110{,}000$` where the whole span is math.
      if (looksLikeMath(inner.trim())) {
        return match
      }
      if (isLikelyCurrencyProseSpan(match, inner, offset, full)) {
        // No math hints — the pair was almost certainly prose accidentally wrapped (most
        // commonly currency in financial answers). Escape both delimiters so remark-math
        // leaves them as literal `$` characters.
        return `\\$${inner}\\$`
      }
      return match
    },
  )
}

function isLikelyCurrencyProseSpan(match: string, inner: string, offset: number, full: string): boolean {
  const afterOpeningDollar = full[offset + 1] ?? ''
  if (!/\d/.test(afterOpeningDollar)) return false

  const afterClosingDollar = full[offset + match.length] ?? ''
  const body = inner.trim()
  return (
    /\d/.test(afterClosingDollar) ||
    /\b[A-Za-z]{2,}\b/.test(body) ||
    /\d(?:,\d{3})+(?:\.\d+)?/.test(body)
  )
}

/** Full math-oriented markdown normalization (delimiters + display promotion). */
export function normalizeAssistantMathMarkdown(text: string): string {
  return normalizeBareBigONotation(
    escapeProsePseudoMath(
      normalizeBareLatexLines(normalizeDoubleDollarMath(normalizeLatexDelimiters(text))),
    ),
  )
}
