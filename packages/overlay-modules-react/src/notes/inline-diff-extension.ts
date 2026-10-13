import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import katex from 'katex'
import DOMPurify from 'dompurify'

const sanitize = (html: string): string =>
  DOMPurify.sanitize(html, {
    ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'mover', 'munder', 'munderover', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd', 'mtext', 'mspace', 'annotation'],
    ADD_ATTR: ['encoding', 'xmlns', 'mathvariant', 'displaystyle', 'scriptlevel', 'columnalign', 'rowspacing', 'columnspacing', 'fence', 'stretchy', 'symmetric', 'lspace', 'rspace', 'movablelimits', 'accent', 'accentunder']
  })

// ── Simple markdown to HTML converter ────────────────────────────────────────────

// Smart split that ignores | inside LaTeX delimiters ($...$)
function splitTableCellsForHtml(content: string): string[] {
  const cells: string[] = []
  let current = ''
  let inMath = false
  let mathDelim = ''

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const nextChar = content[i + 1]

    // Check for $$ (display math delimiter)
    if (char === '$' && nextChar === '$') {
      if (!inMath) {
        inMath = true
        mathDelim = '$$'
        current += '$$'
        i++ // skip next $
      } else if (mathDelim === '$$') {
        inMath = false
        mathDelim = ''
        current += '$$'
        i++ // skip next $
      } else {
        current += char
      }
      continue
    }

    // Check for $ (inline math delimiter)
    if (char === '$') {
      if (!inMath) {
        inMath = true
        mathDelim = '$'
      } else if (mathDelim === '$') {
        inMath = false
        mathDelim = ''
      }
      current += char
      continue
    }

    // Split on | only if not inside math
    if (char === '|' && !inMath) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  // Push remaining content
  if (current.trim()) {
    cells.push(current.trim())
  }

  return cells
}

function renderLatex(latex: string, displayMode: boolean = false): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'html'
    })
  } catch {
    return latex
  }
}

function simpleMarkdownToHtml(text: string): string {
  if (!text || text.trim() === '') return text

  // Check for code fence markers (```language or ```)
  if (/^```\w*$/.test(text.trim())) {
    return `<span style="color: var(--muted); font-family: ui-monospace, monospace; font-size: 0.85em;">${text}</span>`
  }

  // Check for horizontal rule (--- or *** or ___)
  if (/^([-*_])\1{2,}$/.test(text.trim())) {
    return '<hr style="border: none; border-top: 1px solid var(--border); margin: 8px 0;">'
  }

  // Check for standalone $$ marker (part of multi-line display math)
  if (text.trim() === '$$') {
    return '' // Will be handled by multi-line processing in buildWidget
  }

  // Check for table separator line (|---|---| or ---|---)
  if (/^\|?[\s-:|]+\|[\s-:|]*\|?$/.test(text.trim()) && text.includes('-')) {
    return '' // Hide separator row, styling handled by table structure
  }

  // Check for table row - with or without leading/trailing pipes
  // Matches: | cell | cell | OR cell | cell | cell
  const trimmed = text.trim()
  const looksLikeTable = trimmed.includes('|') && !trimmed.startsWith('#')
  if (looksLikeTable) {
    // Remove leading/trailing pipes if present
    let tableContent = trimmed
    if (tableContent.startsWith('|')) tableContent = tableContent.slice(1)
    if (tableContent.endsWith('|')) tableContent = tableContent.slice(0, -1)

    const cells = splitTableCellsForHtml(tableContent)
    if (cells.length >= 2) {
      const cellsHtml = cells
        .map((cell) => {
          // Process LaTeX in table cells
          let processed = cell.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          // Display math
          processed = processed.replace(/\$\$\s*([^$]+?)\s*\$\$/g, (_, latex) =>
            renderLatex(latex.trim(), true)
          )
          // Inline math - allow spaces after $ and before $
          processed = processed.replace(/\$\s*([^$]+?)\s*\$/g, (_, latex) =>
            renderLatex(latex.trim(), false)
          )
          return `<td style="padding: 6px 12px; border: 1px solid var(--border);">${processed}</td>`
        })
        .join('')
      return `<tr>${cellsHtml}</tr>`
    }
  }

  let html = text
    // Escape HTML entities first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // LaTeX: display math $$...$$ (must come before inline math)
  // Allow spaces after $$ and before $$
  html = html.replace(/\$\$\s*([^$]+?)\s*\$\$/g, (_, latex) => renderLatex(latex.trim(), true))

  // LaTeX: inline math $...$ - allow spaces after $ and before $
  html = html.replace(/\$\s*([^$]+?)\s*\$/g, (_, latex) => renderLatex(latex.trim(), false))

  // Headers (### Header -> <strong>Header</strong>)
  html = html.replace(/^###\s+(.+)$/gm, '<strong style="font-size: 1.1em;">$1</strong>')
  html = html.replace(/^##\s+(.+)$/gm, '<strong style="font-size: 1.15em;">$1</strong>')
  html = html.replace(/^#\s+(.+)$/gm, '<strong style="font-size: 1.2em;">$1</strong>')

  // Bold: **text** or __text__
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')

  // Italic: *text* or _text_ (but not inside words)
  html = html.replace(/(?<![\w*])\*([^*]+)\*(?![\w*])/g, '<em>$1</em>')
  html = html.replace(/(?<![\w_])_([^_]+)_(?![\w_])/g, '<em>$1</em>')

  // Inline code: `code`
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background: var(--surface-subtle); color: var(--foreground); padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 0.9em;">$1</code>'
  )

  // Links: [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<span style="color: var(--link, rgb(37, 99, 235)); text-decoration: underline;">$1</span>'
  )

  return html
}

// ── Types ───────────────────────────────────────────────────────────────────────

export interface DiffProposal {
  id: string
  description: string
  startLine: number // 1-based, inclusive
  endLine: number // 1-based, inclusive
  originalLines: string[]
  newLines: string[]
  status: 'pending' | 'accepted' | 'rejected'
}

// ── Tiptap command augmentation ─────────────────────────────────────────────────

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineDiff: {
      addDiffProposal: (proposal: Omit<DiffProposal, 'status'>) => ReturnType
      acceptDiff: (id: string) => ReturnType
      rejectDiff: (id: string) => ReturnType
      acceptAllDiffs: () => ReturnType
      rejectAllDiffs: () => ReturnType
      clearAllDiffs: () => ReturnType
    }
  }
}

// ── Helper to get pending diffs from editor state ──────────────────────────────

export function getPendingDiffs(
  editor: { state: { doc: PMNode } } & { view?: unknown }
): DiffProposal[] {
  const state = editor.state as Parameters<typeof diffPluginKey.getState>[0]
  const proposals = diffPluginKey.getState(state) ?? []
  return proposals.filter((p: DiffProposal) => p.status === 'pending')
}

// ── Plugin key ──────────────────────────────────────────────────────────────────

export const diffPluginKey = new PluginKey<DiffProposal[]>('inlineDiff')

// ── Helpers ─────────────────────────────────────────────────────────────────────

import type { Schema } from '@tiptap/pm/model'

/**
 * Parse a markdown line into ProseMirror text nodes with appropriate marks.
 * Returns an array of text nodes that can be used as paragraph content.
 */
function parseMarkdownLine(
  line: string,
  schema: Schema,
  insideCodeBlock: boolean = false
): PMNode[] {
  if (!line || line.trim() === '') {
    return []
  }

  // Inside code blocks, return as code-marked text (preserve formatting)
  if (insideCodeBlock) {
    const codeMark = schema.marks.code?.create()
    return codeMark ? [schema.text(line, [codeMark])] : [schema.text(line)]
  }

  // Code fence markers - return as code text
  if (/^```\w*$/.test(line.trim())) {
    const codeMark = schema.marks.code?.create()
    return codeMark ? [schema.text(line, [codeMark])] : [schema.text(line)]
  }

  // Handle headers - strip markdown and return bold text
  const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)
  if (headerMatch) {
    const content = headerMatch[2]
    const boldMark = schema.marks.bold?.create()
    return boldMark ? [schema.text(content, [boldMark])] : [schema.text(content)]
  }

  // Handle list items - strip prefix, parse rest
  const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
  let textToParse = line
  let listPrefix = ''
  if (listMatch) {
    listPrefix = listMatch[1] + listMatch[2] + ' '
    textToParse = listMatch[3]
  }

  // Parse inline formatting
  const nodes: PMNode[] = []

  // Add list prefix as plain text if present
  if (listPrefix) {
    nodes.push(schema.text(listPrefix))
  }

  // Regex patterns for inline formatting (simpler patterns, order matters)
  const patterns: Array<{
    regex: RegExp
    markType: string
    isLink?: boolean
    isMath?: boolean
    isDisplayMath?: boolean
  }> = [
    // Display math first ($$...$$) - must come before inline math
    { regex: /\$\$([^$]+)\$\$/g, markType: 'blockMath', isMath: true, isDisplayMath: true },
    // Inline math ($...$) - simpler pattern without lookbehind
    { regex: /\$([^$]+)\$/g, markType: 'inlineMath', isMath: true },
    // Text formatting
    { regex: /\*\*([^*]+)\*\*/g, markType: 'bold' },
    { regex: /__([^_]+)__/g, markType: 'bold' },
    { regex: /\*([^*]+)\*/g, markType: 'italic' },
    { regex: /_([^_]+)_/g, markType: 'italic' },
    { regex: /`([^`]+)`/g, markType: 'code' },
    { regex: /\[([^\]]+)\]\(([^)]+)\)/g, markType: 'link', isLink: true }
  ]

  // Find all matches and their positions
  const allMatches: Array<{
    start: number
    end: number
    content: string
    markType: string
    href?: string
    isMath?: boolean
    isDisplayMath?: boolean
  }> = []

  for (const { regex, markType, isLink, isMath, isDisplayMath } of patterns) {
    regex.lastIndex = 0 // Reset regex state
    let match: RegExpExecArray | null
    while ((match = regex.exec(textToParse)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[1].trim(),
        markType,
        href: isLink ? match[2] : undefined,
        isMath,
        isDisplayMath
      })
    }
  }

  // Sort by start position
  allMatches.sort((a, b) => a.start - b.start)

  // Remove overlapping matches (keep first)
  const filteredMatches: typeof allMatches = []
  let lastEnd = 0
  for (const match of allMatches) {
    if (match.start >= lastEnd) {
      filteredMatches.push(match)
      lastEnd = match.end
    }
  }

  // Build segments
  let currentPos = 0
  for (const match of filteredMatches) {
    // Add plain text before this match
    if (match.start > currentPos) {
      const plainText = textToParse.slice(currentPos, match.start)
      if (plainText) {
        nodes.push(schema.text(plainText))
      }
    }

    // Handle math - create math nodes directly if schema supports it
    if (match.isMath && match.content) {
      const latex = match.content.trim()
      // Use blockMath for display math ($$...$$), inlineMath for inline ($...$)
      const mathNodeType = match.isDisplayMath
        ? schema.nodes.blockMath || schema.nodes.inlineMath
        : schema.nodes.inlineMath
      if (mathNodeType) {
        try {
          const mathNode = mathNodeType.create({ latex })
          nodes.push(mathNode)
        } catch {
          // Fallback to text if node creation fails
          const delim = match.isDisplayMath ? '$$' : '$'
          nodes.push(schema.text(`${delim}${latex}${delim}`))
        }
      } else {
        // Schema doesn't have math nodes, insert as text for migration
        const delim = match.isDisplayMath ? '$$' : '$'
        nodes.push(schema.text(`${delim}${latex}${delim}`))
      }
    } else {
      // Add the marked text (use link mark for links with href)
      let mark = schema.marks[match.markType]?.create(
        match.markType === 'link' && match.href ? { href: match.href } : undefined
      )
      if (!mark && match.markType === 'link') {
        // Fallback: use underline mark if link mark doesn't exist
        mark = schema.marks.underline?.create()
      }
      if (mark && match.content) {
        nodes.push(schema.text(match.content, [mark]))
      } else if (match.content) {
        nodes.push(schema.text(match.content))
      }
    }

    currentPos = match.end
  }

  // Add remaining plain text
  if (currentPos < textToParse.length) {
    const remainingText = textToParse.slice(currentPos)
    if (remainingText) {
      nodes.push(schema.text(remainingText))
    }
  }

  // If only list prefix was added (empty content after), return as-is
  if (nodes.length === 0 || (listPrefix && nodes.length === 1)) {
    return listPrefix ? [schema.text(line)] : [schema.text(line)]
  }

  return nodes
}

/**
 * Parse multiple markdown lines, tracking code block state.
 * Returns array of ProseMirror nodes (paragraphs and codeBlocks).
 */
function parseMarkdownLines(lines: string[], schema: Schema): PMNode[] {
  const nodes: PMNode[] = []
  let insideCodeBlock = false
  let codeBlockLines: string[] = []
  let codeBlockLanguage = ''
  let insideDisplayMath = false
  let displayMathLines: string[] = []
  let lastWasEmpty = false
  let tableRowsData: string[][] = [] // Collect table rows as arrays of cell strings

  // Helper to check if a line is a table separator
  const isTableSeparator = (l: string): boolean => {
    return /^\|?[\s-:|]+\|[\s-:|]*\|?$/.test(l.trim()) && l.includes('-')
  }

  // Helper to check if a line is a table row
  const isTableRowLine = (l: string): boolean => {
    const t = l.trim()
    return t.includes('|') && !t.startsWith('#') && !t.startsWith('```')
  }

  // Smart split that ignores | inside LaTeX delimiters ($...$)
  const splitTableCells = (content: string): string[] => {
    const cells: string[] = []
    let current = ''
    let inMath = false
    let mathDelim = ''

    for (let i = 0; i < content.length; i++) {
      const char = content[i]
      const nextChar = content[i + 1]

      // Check for $$ (display math delimiter)
      if (char === '$' && nextChar === '$') {
        if (!inMath) {
          inMath = true
          mathDelim = '$$'
          current += '$$'
          i++ // skip next $
        } else if (mathDelim === '$$') {
          inMath = false
          mathDelim = ''
          current += '$$'
          i++ // skip next $
        } else {
          current += char
        }
        continue
      }

      // Check for $ (inline math delimiter)
      if (char === '$') {
        if (!inMath) {
          inMath = true
          mathDelim = '$'
        } else if (mathDelim === '$') {
          inMath = false
          mathDelim = ''
        }
        current += char
        continue
      }

      // Split on | only if not inside math
      if (char === '|' && !inMath) {
        cells.push(current.trim())
        current = ''
        continue
      }

      current += char
    }

    // Push remaining content
    if (current.trim()) {
      cells.push(current.trim())
    }

    return cells
  }

  // Flush collected table rows as a proper table node
  const flushTable = (): void => {
    if (tableRowsData.length === 0) return

    // Check if schema has table nodes
    if (schema.nodes.table && schema.nodes.tableRow && schema.nodes.tableCell) {
      const rows: PMNode[] = []
      for (let rowIdx = 0; rowIdx < tableRowsData.length; rowIdx++) {
        const cellStrings = tableRowsData[rowIdx]
        const isHeader = rowIdx === 0 && schema.nodes.tableHeader
        const cells: PMNode[] = cellStrings.map((cellText) => {
          const cellContent = parseMarkdownLine(cellText, schema, false)
          const cellNode = isHeader
            ? schema.nodes.tableHeader.create(
                null,
                schema.nodes.paragraph.create(null, cellContent)
              )
            : schema.nodes.tableCell.create(null, schema.nodes.paragraph.create(null, cellContent))
          return cellNode
        })
        rows.push(schema.nodes.tableRow.create(null, cells))
      }
      nodes.push(schema.nodes.table.create(null, rows))
    } else {
      // Fallback: create paragraphs with pipe-separated text
      for (const cellStrings of tableRowsData) {
        const tableText = cellStrings.join(' | ')
        const content = parseMarkdownLine(tableText, schema, false)
        nodes.push(schema.nodes.paragraph.create(null, content))
      }
    }
    tableRowsData = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Check for code fence markers
    const fenceMatch = line.trim().match(/^```(\w*)$/)
    if (fenceMatch) {
      if (!insideCodeBlock) {
        // Starting a code block
        insideCodeBlock = true
        codeBlockLanguage = fenceMatch[1] || ''
        codeBlockLines = []
      } else {
        // Ending a code block - create codeBlock node
        insideCodeBlock = false
        const codeContent = codeBlockLines.join('\n')
        if (schema.nodes.codeBlock) {
          const codeBlockNode = schema.nodes.codeBlock.create(
            { language: codeBlockLanguage },
            codeContent ? schema.text(codeContent) : null
          )
          nodes.push(codeBlockNode)
        } else {
          // Fallback: create paragraphs with code marks
          for (const codeLine of codeBlockLines) {
            const codeMark = schema.marks.code?.create()
            const content = codeMark ? [schema.text(codeLine)] : [schema.text(codeLine)]
            nodes.push(schema.nodes.paragraph.create(null, content))
          }
        }
        codeBlockLines = []
        codeBlockLanguage = ''
      }
      lastWasEmpty = false
      continue
    }

    if (insideCodeBlock) {
      // Collect code block lines
      codeBlockLines.push(line)
      continue
    }

    const trimmedLine = line.trim()

    // Handle display math - various formats
    if (insideDisplayMath) {
      // Check if this line ends the display math
      if (trimmedLine.endsWith('$$')) {
        const content = trimmedLine.slice(0, -2)
        if (content) displayMathLines.push(content)
        insideDisplayMath = false
        const latex = displayMathLines.join('\n').trim()
        // Create actual blockMath node if available
        const mathNodeType = schema.nodes.blockMath || schema.nodes.inlineMath
        if (mathNodeType) {
          try {
            nodes.push(mathNodeType.create({ latex }))
          } catch {
            // Fallback to paragraph with text
            nodes.push(schema.nodes.paragraph.create(null, [schema.text(`$$${latex}$$`)]))
          }
        } else {
          nodes.push(schema.nodes.paragraph.create(null, [schema.text(`$$${latex}$$`)]))
        }
        displayMathLines = []
      } else {
        displayMathLines.push(line)
      }
      lastWasEmpty = false
      continue
    }

    // Check for standalone $$ delimiter
    if (trimmedLine === '$$') {
      insideDisplayMath = true
      displayMathLines = []
      lastWasEmpty = false
      continue
    }

    // Check for single-line $$content$$
    if (trimmedLine.startsWith('$$') && trimmedLine.endsWith('$$') && trimmedLine.length > 4) {
      const latex = trimmedLine.slice(2, -2).trim()
      // Create actual blockMath node if available
      const mathNodeType = schema.nodes.blockMath || schema.nodes.inlineMath
      if (mathNodeType) {
        try {
          nodes.push(mathNodeType.create({ latex }))
        } catch {
          nodes.push(schema.nodes.paragraph.create(null, [schema.text(`$$${latex}$$`)]))
        }
      } else {
        nodes.push(schema.nodes.paragraph.create(null, [schema.text(`$$${latex}$$`)]))
      }
      lastWasEmpty = false
      continue
    }

    // Check for multi-line start: $$content...
    if (trimmedLine.startsWith('$$')) {
      insideDisplayMath = true
      displayMathLines = [trimmedLine.slice(2)]
      lastWasEmpty = false
      continue
    }

    // Check for horizontal rule (--- or *** or ___)
    if (/^([-*_])\1{2,}$/.test(line.trim())) {
      if (schema.nodes.horizontalRule) {
        nodes.push(schema.nodes.horizontalRule.create())
      } else {
        // Fallback: create empty paragraph as separator
        nodes.push(schema.nodes.paragraph.create())
      }
      lastWasEmpty = false
      continue
    }

    // Check for table separator line - skip it but don't break table collection
    if (isTableSeparator(line)) {
      continue
    }

    // Check for table row - collect into tableRowsData
    if (isTableRowLine(line)) {
      let tableContent = trimmedLine
      if (tableContent.startsWith('|')) tableContent = tableContent.slice(1)
      if (tableContent.endsWith('|')) tableContent = tableContent.slice(0, -1)
      const cells = splitTableCells(tableContent)
      if (cells.length >= 2) {
        tableRowsData.push(cells)
        lastWasEmpty = false
        continue
      }
    }

    // Not a table row - flush any collected table first
    flushTable()

    if (trimmedLine === '') {
      // Skip consecutive empty lines to avoid excessive spacing
      if (!lastWasEmpty) {
        nodes.push(schema.nodes.paragraph.create())
        lastWasEmpty = true
      }
    } else {
      const content = parseMarkdownLine(line, schema, false)
      nodes.push(schema.nodes.paragraph.create(null, content))
      lastWasEmpty = false
    }
  }

  // Flush any remaining table
  flushTable()

  // Handle unclosed code block
  if (insideCodeBlock && codeBlockLines.length > 0) {
    const codeContent = codeBlockLines.join('\n')
    if (schema.nodes.codeBlock) {
      nodes.push(
        schema.nodes.codeBlock.create(
          { language: codeBlockLanguage },
          codeContent ? schema.text(codeContent) : null
        )
      )
    }
  }

  return nodes
}

/**
 * Returns [{from, to}] for block-level children of doc at the given 1-based line range.
 * Each top-level child of doc counts as one line.
 */
function getBlockRanges(
  doc: PMNode,
  startLine: number,
  endLine: number
): Array<{ from: number; to: number }> {
  const result: Array<{ from: number; to: number }> = []
  let line = 0
  doc.forEach((node, offset) => {
    line++
    if (line >= startLine && line <= endLine) {
      result.push({ from: offset, to: offset + node.nodeSize })
    }
  })
  return result
}

// ── Widget DOM builder ──────────────────────────────────────────────────────────

function buildWidget(
  proposal: DiffProposal,
  onAccept: (id: string) => void,
  onReject: (id: string) => void
): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'inline-diff-widget'
  wrap.setAttribute('data-diff-id', proposal.id)
  wrap.contentEditable = 'false'

  // ── Inserted lines with markdown rendering ─────────────────────────────
  if (proposal.newLines.length > 0) {
    const linesContainer = document.createElement('div')
    linesContainer.className = 'inline-diff-inserted-lines'

    let insideCodeBlock = false
    let codeBlockContent: string[] = []
    let insideDisplayMath = false
    let displayMathContent: string[] = []
    let tableRows: string[] = []

    const flushCodeBlock = (): void => {
      if (codeBlockContent.length > 0) {
        const codeBlock = document.createElement('div')
        codeBlock.className = 'inline-diff-code-block'
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = codeBlockContent.join('\n')
        pre.appendChild(code)
        codeBlock.appendChild(pre)
        linesContainer.appendChild(codeBlock)
        codeBlockContent = []
      }
    }

    const flushDisplayMath = (): void => {
      if (displayMathContent.length > 0) {
        const mathRow = document.createElement('div')
        mathRow.className = 'inline-diff-line inline-diff-line-added'
        const marker = document.createElement('span')
        marker.className = 'inline-diff-marker'
        marker.textContent = '+'
        const text = document.createElement('span')
        text.className = 'inline-diff-text'
        text.innerHTML = sanitize(renderLatex(displayMathContent.join('\n').trim(), true))
        mathRow.appendChild(marker)
        mathRow.appendChild(text)
        linesContainer.appendChild(mathRow)
        displayMathContent = []
      }
    }

    const flushTable = (): void => {
      if (tableRows.length > 0) {
        const tableRow = document.createElement('div')
        tableRow.className = 'inline-diff-line inline-diff-line-added'
        const marker = document.createElement('span')
        marker.className = 'inline-diff-marker'
        marker.textContent = '+'
        const text = document.createElement('span')
        text.className = 'inline-diff-text'
        text.innerHTML = sanitize(`<table style="border-collapse: collapse; width: 100%; margin: 4px 0;">${tableRows.join('')}</table>`)
        tableRow.appendChild(marker)
        tableRow.appendChild(text)
        linesContainer.appendChild(tableRow)
        tableRows = []
      }
    }

    // Helper to check if a line is a table row
    const isTableRow = (line: string): boolean => {
      const t = line.trim()
      return t.includes('|') && !t.startsWith('#') && !t.startsWith('```')
    }

    // Helper to check if a line is a table separator
    const isTableSeparator = (line: string): boolean => {
      return /^\|?[\s-:|]+\|[\s-:|]*\|?$/.test(line.trim()) && line.includes('-')
    }

    for (const line of proposal.newLines) {
      // Check for code fence
      if (/^```\w*$/.test(line.trim())) {
        if (!insideCodeBlock) {
          insideCodeBlock = true
          codeBlockContent = []
        } else {
          insideCodeBlock = false
          flushCodeBlock()
        }
        continue
      }

      if (insideCodeBlock) {
        codeBlockContent.push(line)
        continue
      }

      const trimmed = line.trim()

      // Check for display math - handle various formats:
      // 1. Just "$$" on its own line (delimiter)
      // 2. "$$content$$" all on one line
      // 3. "$$content..." starts multi-line
      // 4. "...content$$" ends multi-line

      if (insideDisplayMath) {
        // Check if this line ends the display math
        if (trimmed.endsWith('$$')) {
          const content = trimmed.slice(0, -2)
          if (content) displayMathContent.push(content)
          insideDisplayMath = false
          flushDisplayMath()
        } else {
          displayMathContent.push(line)
        }
        continue
      }

      // Not inside display math - check if this line starts it
      if (trimmed === '$$') {
        // Standalone delimiter - start collecting
        insideDisplayMath = true
        displayMathContent = []
        continue
      }

      if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
        // Single-line display math: $$content$$
        const content = trimmed.slice(2, -2).trim()
        const mathRow = document.createElement('div')
        mathRow.className = 'inline-diff-line inline-diff-line-added'
        const marker = document.createElement('span')
        marker.className = 'inline-diff-marker'
        marker.textContent = '+'
        const text = document.createElement('span')
        text.className = 'inline-diff-text'
        text.innerHTML = sanitize(renderLatex(content, true))
        mathRow.appendChild(marker)
        mathRow.appendChild(text)
        linesContainer.appendChild(mathRow)
        continue
      }

      if (trimmed.startsWith('$$')) {
        // Starts multi-line display math: $$content...
        insideDisplayMath = true
        displayMathContent = [trimmed.slice(2)]
        continue
      }

      // Check for table row or separator
      if (isTableSeparator(line)) {
        // Skip separator rows, they don't render
        continue
      }

      if (isTableRow(line)) {
        // Collect table row HTML
        const rowHtml = simpleMarkdownToHtml(line)
        if (rowHtml) {
          tableRows.push(rowHtml)
        }
        continue
      }

      // Not a table row - flush any collected table rows first
      flushTable()

      // Regular line - render with markdown
      const row = document.createElement('div')
      row.className = 'inline-diff-line inline-diff-line-added'
      const marker = document.createElement('span')
      marker.className = 'inline-diff-marker'
      marker.textContent = '+'
      const text = document.createElement('span')
      text.className = 'inline-diff-text'
      text.innerHTML = sanitize(simpleMarkdownToHtml(line) || '\u00A0')
      row.appendChild(marker)
      row.appendChild(text)
      linesContainer.appendChild(row)
    }

    // Flush any unclosed code block, display math, or table
    if (insideCodeBlock) {
      flushCodeBlock()
    }
    if (insideDisplayMath) {
      flushDisplayMath()
    }
    flushTable()

    wrap.appendChild(linesContainer)
  } else {
    // Pure deletion — show a "(delete)" label
    const del = document.createElement('div')
    del.className = 'inline-diff-deletion-label'
    del.textContent = '(delete lines)'
    wrap.appendChild(del)
  }

  // ── Action bar ──────────────────────────────────────────────────────────────
  const bar = document.createElement('div')
  bar.className = 'inline-diff-action-bar'

  const desc = document.createElement('span')
  desc.className = 'inline-diff-desc'
  desc.textContent = proposal.description

  const btnGroup = document.createElement('div')
  btnGroup.className = 'inline-diff-btn-group'

  const acceptBtn = document.createElement('button')
  acceptBtn.className = 'inline-diff-btn inline-diff-accept'
  acceptBtn.textContent = 'Accept'
  acceptBtn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onAccept(proposal.id)
  })

  const rejectBtn = document.createElement('button')
  rejectBtn.className = 'inline-diff-btn inline-diff-reject'
  rejectBtn.textContent = 'Reject'
  rejectBtn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onReject(proposal.id)
  })

  btnGroup.appendChild(acceptBtn)
  btnGroup.appendChild(rejectBtn)
  bar.appendChild(desc)
  bar.appendChild(btnGroup)
  wrap.appendChild(bar)

  return wrap
}

// ── Decoration builder ──────────────────────────────────────────────────────────

function buildDecorations(
  doc: PMNode,
  proposals: DiffProposal[],
  onAccept: (id: string) => void,
  onReject: (id: string) => void
): DecorationSet {
  const decos: Decoration[] = []

  for (const proposal of proposals) {
    if (proposal.status !== 'pending') continue

    const ranges = getBlockRanges(doc, proposal.startLine, proposal.endLine)
    if (ranges.length === 0) continue

    // Mark each removed block with a node decoration
    for (const { from, to } of ranges) {
      decos.push(Decoration.node(from, to, { class: 'inline-diff-removed' }))
    }

    // Insert widget (new content + buttons) directly after the last removed block
    const insertAt = ranges[ranges.length - 1].to
    decos.push(
      Decoration.widget(insertAt, () => buildWidget(proposal, onAccept, onReject), {
        side: 1,
        key: `inline-diff-widget-${proposal.id}`
      })
    )
  }

  return DecorationSet.create(doc, decos)
}

// ── Extension ───────────────────────────────────────────────────────────────────

export const InlineDiffExtension = Extension.create({
  name: 'inlineDiff',

  addCommands() {
    return {
      addDiffProposal:
        (proposal) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            const full: DiffProposal = { ...proposal, status: 'pending' }
            dispatch(tr.setMeta(diffPluginKey, { type: 'add', proposal: full }))
          }
          return true
        },

      acceptDiff:
        (id) =>
        ({ tr, state, dispatch }) => {
          const proposals = diffPluginKey.getState(state) ?? []
          const proposal = proposals.find((p) => p.id === id)
          if (!proposal || proposal.status !== 'pending') return false
          if (!dispatch) return true

          const { schema } = state
          const ranges = getBlockRanges(state.doc, proposal.startLine, proposal.endLine)
          if (ranges.length === 0) {
            dispatch(tr.setMeta(diffPluginKey, { type: 'accept', id }))
            return true
          }

          const from = ranges[0].from
          const to = ranges[ranges.length - 1].to

          // Build replacement nodes from newLines with markdown parsing
          const newNodes = parseMarkdownLines(proposal.newLines, schema)

          // If newLines is empty (pure deletion), replaceWith empty array = delete the range
          let newTr = tr.replaceWith(from, to, newNodes)
          newTr = newTr.setMeta(diffPluginKey, { type: 'accept', id })
          dispatch(newTr)
          return true
        },

      rejectDiff:
        (id) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            dispatch(tr.setMeta(diffPluginKey, { type: 'reject', id }))
          }
          return true
        },

      acceptAllDiffs:
        () =>
        ({ tr, state, dispatch }) => {
          const proposals = diffPluginKey.getState(state) ?? []
          const pending = proposals.filter((p) => p.status === 'pending')
          if (pending.length === 0) return false
          if (!dispatch) return true

          const { schema } = state
          let newTr = tr

          // Process in reverse order (highest line first) to avoid position shifts
          const sorted = [...pending].sort((a, b) => b.startLine - a.startLine)

          for (const proposal of sorted) {
            const ranges = getBlockRanges(newTr.doc, proposal.startLine, proposal.endLine)
            if (ranges.length === 0) continue

            const from = ranges[0].from
            const to = ranges[ranges.length - 1].to

            const newNodes = parseMarkdownLines(proposal.newLines, schema)

            newTr = newTr.replaceWith(from, to, newNodes)
          }

          newTr = newTr.setMeta(diffPluginKey, { type: 'clear' })
          dispatch(newTr)
          return true
        },

      rejectAllDiffs:
        () =>
        ({ tr, state, dispatch }) => {
          const proposals = diffPluginKey.getState(state) ?? []
          const pending = proposals.filter((p) => p.status === 'pending')
          if (pending.length === 0) return false
          if (dispatch) {
            dispatch(tr.setMeta(diffPluginKey, { type: 'clear' }))
          }
          return true
        },

      clearAllDiffs:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            dispatch(tr.setMeta(diffPluginKey, { type: 'clear' }))
          }
          return true
        }
    }
  },

  addProseMirrorPlugins() {
    const getEditor = (): typeof this.editor => this.editor

    return [
      new Plugin<DiffProposal[]>({
        key: diffPluginKey,

        state: {
          init: () => [],
          apply(tr, prev) {
            const meta = tr.getMeta(diffPluginKey) as
              | { type: 'add'; proposal: DiffProposal }
              | { type: 'accept' | 'reject'; id: string }
              | { type: 'clear' }
              | undefined

            if (!meta) return prev

            switch (meta.type) {
              case 'add':
                return [...prev, meta.proposal]
              case 'accept':
                return prev.map((p) =>
                  p.id === meta.id ? { ...p, status: 'accepted' as const } : p
                )
              case 'reject':
                return prev.map((p) =>
                  p.id === meta.id ? { ...p, status: 'rejected' as const } : p
                )
              case 'clear':
                return []
              default:
                return prev
            }
          }
        },

        props: {
          decorations(state) {
            const proposals = diffPluginKey.getState(state) ?? []
            const pending = proposals.filter((p) => p.status === 'pending')
            if (pending.length === 0) return DecorationSet.empty

            return buildDecorations(
              state.doc,
              pending,
              (id) => getEditor().commands.acceptDiff(id),
              (id) => getEditor().commands.rejectDiff(id)
            )
          }
        }
      })
    ]
  }
})

// ── CSS (injected once) ─────────────────────────────────────────────────────────

export const INLINE_DIFF_CSS = `
  /* Removed paragraphs — subtle red highlight without strikethrough */
  .ProseMirror .inline-diff-removed {
    background: rgba(255, 59, 48, 0.08) !important;
    color: color-mix(in srgb, var(--foreground) 55%, transparent);
    opacity: 0.7;
    border-left: 2px solid rgba(255, 59, 48, 0.35);
    padding-left: 6px;
    transition: all 0.15s ease;
  }

  /* Widget container */
  .inline-diff-widget {
    user-select: none;
    font-family: system-ui, -apple-system, sans-serif;
    margin: 0;
  }

  /* Added lines block */
  .inline-diff-inserted-lines {
    border-left: 2px solid rgba(52, 199, 89, 0.55);
    background: rgba(52, 199, 89, 0.08);
    padding: 0;
  }

  .inline-diff-line {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 1px 8px 1px 6px;
    font-size: inherit;
    line-height: inherit;
  }

  .inline-diff-line-added {
    color: var(--foreground);
  }

  /* Code block in diff preview */
  .inline-diff-code-block {
    margin: 4px 8px;
    border-radius: 8px;
    overflow: hidden;
  }

  .inline-diff-code-block pre {
    margin: 0;
    padding: 12px 16px;
    background: var(--surface-subtle);
    border-radius: 8px;
    overflow-x: auto;
  }

  .inline-diff-code-block code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    font-size: 13px;
    line-height: 1.5;
    color: var(--foreground);
    white-space: pre;
  }

  .inline-diff-marker {
    color: rgba(52, 199, 89, 0.6);
    font-family: ui-monospace, monospace;
    font-size: 11px;
    flex-shrink: 0;
    margin-top: 2px;
    user-select: none;
  }

  .inline-diff-deletion-label {
    padding: 2px 8px;
    font-size: 11px;
    color: var(--muted);
    font-style: italic;
    border-left: 2px solid rgba(255, 59, 48, 0.3);
  }

  /* Action bar */
  .inline-diff-action-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 4px 8px;
    gap: 8px;
    border-top: 1px solid var(--border);
    background: var(--surface-muted);
  }

  .inline-diff-desc {
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .inline-diff-btn-group {
    display: flex;
    gap: 5px;
    flex-shrink: 0;
  }

  .inline-diff-btn {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-family: system-ui, -apple-system, sans-serif;
    font-weight: 500;
    line-height: 1;
    transition: background 0.15s ease;
    background: transparent;
    color: inherit;
  }

  .inline-diff-accept:hover,
  .inline-diff-reject:hover {
    background: var(--surface-subtle);
  }

`
