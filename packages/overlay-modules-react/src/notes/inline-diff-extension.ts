import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import katex from 'katex'
import DOMPurify from 'dompurify'
import { diffBlockKeys } from './agent-edit-diff'

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

/**
 * One change the assistant already saved to the note. The editor shows the saved
 * blocks between `from` and `to` (empty for a pure deletion) beside the blocks they
 * replaced. Accepting keeps the change; rejecting restores `originalBlocks`.
 */
export interface DiffProposal {
  id: string
  description: string
  from: number
  to: number
  originalBlocks: Record<string, unknown>[]
  originalLines: string[]
  status: 'pending' | 'accepted' | 'rejected'
}

type DiffMeta =
  | { type: 'set'; proposals: DiffProposal[] }
  | { type: 'accept' | 'reject'; id: string }
  | { type: 'clear' }

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineDiff: {
      /** Shows every block that differs from `baseBlocks` (the note before the assistant edited it). */
      showAgentEdits: (baseBlocks: readonly Record<string, unknown>[]) => ReturnType
      acceptDiff: (id: string) => ReturnType
      rejectDiff: (id: string) => ReturnType
      acceptAllDiffs: () => ReturnType
      rejectAllDiffs: () => ReturnType
      clearAllDiffs: () => ReturnType
    }
  }
}

export const diffPluginKey = new PluginKey<DiffProposal[]>('inlineDiff')

export function getPendingDiffs(
  editor: { state: { doc: PMNode } } & { view?: unknown }
): DiffProposal[] {
  const state = editor.state as Parameters<typeof diffPluginKey.getState>[0]
  const proposals = diffPluginKey.getState(state) ?? []
  return proposals.filter((p: DiffProposal) => p.status === 'pending')
}

// ── Block diff ──────────────────────────────────────────────────────────────────

type Block = { json: Record<string, unknown>; key: string; text: string }

function docBlocks(doc: PMNode): Array<Block & { from: number; to: number }> {
  const blocks: Array<Block & { from: number; to: number }> = []
  doc.forEach((node, offset) => {
    const json = node.toJSON() as Record<string, unknown>
    blocks.push({ json, key: JSON.stringify(json), text: node.textContent, from: offset, to: offset + node.nodeSize })
  })
  return blocks
}

/** The note as it was before the assistant's unresolved changes: pending changes are swapped back to their originals. */
export function agentReviewBase(editor: { state: { doc: PMNode } }): Record<string, unknown>[] {
  const pending = getPendingDiffs(editor).sort((a, b) => a.from - b.from)
  const blocks: Record<string, unknown>[] = []
  let next = 0
  for (const block of docBlocks(editor.state.doc)) {
    while (next < pending.length && pending[next]!.to <= block.from) {
      blocks.push(...pending[next]!.originalBlocks)
      next += 1
    }
    const inside = pending.some((p) => block.from >= p.from && block.to <= p.to && p.from < p.to)
    if (!inside) blocks.push(block.json)
  }
  for (; next < pending.length; next += 1) blocks.push(...pending[next]!.originalBlocks)
  return blocks
}

function describe(removed: number, added: number): string {
  if (removed === 0) return added === 1 ? 'Added 1 block' : `Added ${added} blocks`
  if (added === 0) return removed === 1 ? 'Removed 1 block' : `Removed ${removed} blocks`
  return added === 1 && removed === 1 ? 'Changed 1 block' : `Changed ${Math.max(added, removed)} blocks`
}

function proposalsFor(doc: PMNode, baseBlocks: readonly Record<string, unknown>[]): DiffProposal[] {
  const current = docBlocks(doc)
  const base = baseBlocks.map((json) => ({ json, key: JSON.stringify(json) }))
  return diffBlockKeys(base.map((block) => block.key), current.map((block) => block.key)).map(
    ([baseStart, baseEnd, docStart, docEnd], index) => {
      const from = docStart < current.length ? current[docStart]!.from : doc.content.size
      const to = docEnd > docStart ? current[docEnd - 1]!.to : from
      const originalBlocks = base.slice(baseStart, baseEnd).map((block) => block.json)
      return {
        id: `agent-edit-${index}-${from}`,
        description: describe(baseEnd - baseStart, docEnd - docStart),
        from,
        to,
        originalBlocks,
        originalLines: originalBlocks.map((json) => doc.type.schema.nodeFromJSON(json).textContent),
        status: 'pending' as const,
      }
    },
  )
}

function restoreOriginal(tr: Transaction, proposal: DiffProposal): Transaction {
  const schema = tr.doc.type.schema
  const from = tr.mapping.map(proposal.from, proposal.from === proposal.to ? -1 : 1)
  const to = Math.max(from, tr.mapping.map(proposal.to, -1))
  let nodes = proposal.originalBlocks.map((json) => schema.nodeFromJSON(json))
  if (nodes.length === 0 && from === 0 && to === tr.doc.content.size) nodes = [schema.nodes.paragraph!.create()]
  return tr.replaceWith(from, to, nodes)
}

function pendingOf(state: EditorState): DiffProposal[] {
  return (diffPluginKey.getState(state) ?? []).filter((p) => p.status === 'pending')
}

// ── Widget DOM builder ──────────────────────────────────────────────────────────

function buildWidget(
  proposal: DiffProposal,
  onAccept: (id: string) => void,
  onReject: (id: string) => void
): HTMLElement {
  const removedLines = proposal.originalLines
  const wrap = document.createElement('div')
  wrap.className = 'inline-diff-widget'
  wrap.setAttribute('data-diff-id', proposal.id)
  wrap.contentEditable = 'false'

  // ── Replaced lines with markdown rendering ─────────────────────────────
  if (removedLines.length > 0) {
    const linesContainer = document.createElement('div')
    linesContainer.className = 'inline-diff-removed-lines'

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
        mathRow.className = 'inline-diff-line inline-diff-line-removed'
        const marker = document.createElement('span')
        marker.className = 'inline-diff-marker'
        marker.textContent = '-'
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
        tableRow.className = 'inline-diff-line inline-diff-line-removed'
        const marker = document.createElement('span')
        marker.className = 'inline-diff-marker'
        marker.textContent = '-'
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

    for (const line of removedLines) {
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
        mathRow.className = 'inline-diff-line inline-diff-line-removed'
        const marker = document.createElement('span')
        marker.className = 'inline-diff-marker'
        marker.textContent = '-'
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
      row.className = 'inline-diff-line inline-diff-line-removed'
      const marker = document.createElement('span')
      marker.className = 'inline-diff-marker'
      marker.textContent = '-'
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
    doc.forEach((node, offset) => {
      if (offset >= proposal.from && offset + node.nodeSize <= proposal.to) {
        decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'inline-diff-added' }))
      }
    })
    decos.push(
      Decoration.widget(proposal.from, () => buildWidget(proposal, onAccept, onReject), {
        side: -1,
        key: `inline-diff-widget-${proposal.id}`,
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
      showAgentEdits:
        (baseBlocks) =>
        ({ tr, state, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(diffPluginKey, { type: 'set', proposals: proposalsFor(state.doc, baseBlocks) }))
          return true
        },

      acceptDiff:
        (id) =>
        ({ tr, state, dispatch }) => {
          if (!pendingOf(state).some((p) => p.id === id)) return false
          if (dispatch) dispatch(tr.setMeta(diffPluginKey, { type: 'accept', id }))
          return true
        },

      rejectDiff:
        (id) =>
        ({ tr, state, dispatch }) => {
          const proposal = pendingOf(state).find((p) => p.id === id)
          if (!proposal) return false
          if (dispatch) dispatch(restoreOriginal(tr, proposal).setMeta(diffPluginKey, { type: 'reject', id }))
          return true
        },

      acceptAllDiffs:
        () =>
        ({ tr, state, dispatch }) => {
          if (pendingOf(state).length === 0) return false
          if (dispatch) dispatch(tr.setMeta(diffPluginKey, { type: 'clear' }))
          return true
        },

      rejectAllDiffs:
        () =>
        ({ tr, state, dispatch }) => {
          const pending = pendingOf(state)
          if (pending.length === 0) return false
          if (!dispatch) return true
          // Highest position first, so earlier ranges are unaffected by each restore.
          let next = tr
          for (const proposal of [...pending].sort((a, b) => b.from - a.from)) next = restoreOriginal(next, proposal)
          dispatch(next.setMeta(diffPluginKey, { type: 'clear' }))
          return true
        },

      clearAllDiffs:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(diffPluginKey, { type: 'clear' }))
          return true
        },
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
            const meta = tr.getMeta(diffPluginKey) as DiffMeta | undefined
            if (meta?.type === 'set') return meta.proposals
            if (meta?.type === 'clear') return []
            const mapped = tr.docChanged
              ? prev.map((p) => {
                  const empty = p.from === p.to
                  const from = tr.mapping.map(p.from, empty ? -1 : 1)
                  return { ...p, from, to: empty ? from : Math.max(from, tr.mapping.map(p.to, -1)) }
                })
              : prev
            if (!meta) return mapped
            return mapped.map((p) =>
              p.id === meta.id ? { ...p, status: meta.type === 'accept' ? 'accepted' as const : 'rejected' as const } : p
            )
          },
        },

        props: {
          decorations(state) {
            const pending = pendingOf(state)
            if (pending.length === 0) return DecorationSet.empty
            return buildDecorations(
              state.doc,
              pending,
              (id) => getEditor().commands.acceptDiff(id),
              (id) => getEditor().commands.rejectDiff(id)
            )
          },
        },
      }),
    ]
  },
})

// ── CSS (injected once) ─────────────────────────────────────────────────────────

export const INLINE_DIFF_CSS = `
  /* Blocks the assistant added or changed */
  .ProseMirror .inline-diff-added {
    background: rgba(52, 199, 89, 0.08) !important;
    border-left: 2px solid rgba(52, 199, 89, 0.55);
    padding-left: 6px;
    transition: all 0.15s ease;
  }

  /* Widget container */
  .inline-diff-widget {
    user-select: none;
    font-family: system-ui, -apple-system, sans-serif;
    margin: 0;
  }

  /* Lines the assistant replaced or removed */
  .inline-diff-removed-lines {
    border-left: 2px solid rgba(255, 59, 48, 0.35);
    background: rgba(255, 59, 48, 0.08);
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

  .inline-diff-line-removed {
    color: color-mix(in srgb, var(--foreground) 60%, transparent);
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
    color: rgba(255, 59, 48, 0.6);
    font-family: ui-monospace, monospace;
    font-size: 11px;
    flex-shrink: 0;
    margin-top: 2px;
    user-select: none;
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
