import type {
  KnowledgeFile,
  NoteDoc,
  NotebookAgentMention,
  NotebookAgentStreamEvent,
  UpdateFileRequest,
} from './contracts'

export const NOTES_CHANGED_EVENT = 'overlay:notes-changed'

export const NOTEBOOK_INLINE_MATH_MIGRATION_REGEX =
  /(?<!\$)\$(?![\d\s$])([^$\n]*(?:\\[a-zA-Z@]+|[=^_{}]|[a-zA-Z]\s*[+\-*/=^_]|[+\-*/=^_]\s*[a-zA-Z]|[a-zA-Z])[^$\n]*)\$(?![\d$])/g

export interface NotebookNote {
  _id: string
  title: string
  content: string
  tags: string[]
  projectId?: string
  createdAt: number
  updatedAt: number
  shareVisibility?: 'private' | 'public'
  shareToken?: string | null
}

export interface CanonicalNoteFile extends Pick<
  KnowledgeFile,
  '_id' | 'name' | 'content' | 'textContent' | 'projectId' | 'createdAt' | 'updatedAt'
> {
  shareVisibility?: 'private' | 'public'
  shareToken?: string | null
}

export type NotebookAgentUiItem =
  | { type: 'user'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; tool: string; toolInput?: Record<string, unknown> }
  | { type: 'text'; text: string }
  | { type: 'error'; text: string }

export interface NotebookMentionLike {
  type: string
  id: string
  name: string
}

export interface NotebookDraftState {
  title: string
  content: string
  isDirty: boolean
  canSave: boolean
}

export interface CreateNotebookDraftStateInput {
  note: Pick<NotebookNote, 'title' | 'content'> | null
  draftTitle: string
  draftContent: string
  saving?: boolean
}

const markdownLineBreak = /\r\n?/g
const htmlTagPattern = /<\/?[a-z][\s\S]*>/i

export function canonicalFileToNotebookNote(file: CanonicalNoteFile, now = Date.now()): NotebookNote {
  return {
    _id: file._id,
    title: file.name || 'Untitled',
    content: file.textContent ?? file.content ?? '',
    tags: [],
    projectId: file.projectId,
    createdAt: file.createdAt ?? now,
    updatedAt: file.updatedAt ?? now,
    shareVisibility: file.shareVisibility,
    shareToken: file.shareToken,
  }
}

/**
 * Notes are rendered alongside files in the app shell. Postgres stores them in
 * a dedicated notes table, while Convex historically exposes them as files.
 */
export function noteDocToKnowledgeFile(note: NoteDoc): KnowledgeFile & { type: 'file' } {
  return {
    _id: note._id,
    name: note.title || 'Untitled',
    type: 'file',
    kind: 'note',
    parentId: null,
    content: note.content,
    textContent: note.content,
    previewText: note.content,
    sizeBytes: note.content.length,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    projectId: note.projectId,
  }
}

export function createLocalNotebookNote(id: string, now = Date.now()): NotebookNote {
  return {
    _id: id,
    title: 'Untitled',
    content: '',
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizeNotebookTitle(value: string, fallback = 'Untitled'): string {
  return value.trim() || fallback
}

export function createNotebookDraftState(input: CreateNotebookDraftStateInput): NotebookDraftState {
  const title = normalizeNotebookTitle(input.draftTitle)
  const originalTitle = input.note?.title ?? ''
  const originalContent = input.note?.content ?? ''
  const isDirty = title !== originalTitle || input.draftContent !== originalContent
  return {
    title,
    content: input.draftContent,
    isDirty,
    canSave: Boolean(input.note) && isDirty && !input.saving,
  }
}

export function upsertNotebookNote(notes: readonly NotebookNote[], note: NotebookNote): NotebookNote[] {
  return [note, ...notes.filter((item) => item._id !== note._id)]
}

export function removeNotebookNote(notes: readonly NotebookNote[], noteId: string): NotebookNote[] {
  return notes.filter((note) => note._id !== noteId)
}

export function createNotebookFileUpdateRequest({
  noteId,
  title,
  content,
}: {
  noteId: string
  title: string
  content: string
}): UpdateFileRequest {
  return {
    fileId: noteId,
    name: title,
    textContent: content,
  }
}

export function createNotebookAgentMentions(mentions: readonly NotebookMentionLike[]): NotebookAgentMention[] {
  return mentions.map((mention) => ({
    type: mention.type,
    id: mention.id,
    name: mention.name,
  }))
}

export function createNotebookPersistedNote({
  noteId,
  title,
  content,
  file,
  fallbackNote,
  now = Date.now(),
}: {
  noteId: string
  title: string
  content: string
  file?: CanonicalNoteFile | null
  fallbackNote?: Pick<NotebookNote, 'createdAt' | 'projectId' | 'shareVisibility' | 'shareToken'> | null
  now?: number
}): NotebookNote {
  if (file) return canonicalFileToNotebookNote(file, now)
  return {
    _id: noteId,
    title: normalizeNotebookTitle(title),
    content,
    tags: [],
    projectId: fallbackNote?.projectId,
    createdAt: fallbackNote?.createdAt ?? now,
    updatedAt: now,
    shareVisibility: fallbackNote?.shareVisibility,
    shareToken: fallbackNote?.shareToken,
  }
}

export function createRenamedNotebookNote({
  note,
  title,
  content,
  now = Date.now(),
}: {
  note: NotebookNote
  title: string
  content: string
  now?: number
}): NotebookNote {
  return {
    ...note,
    title: normalizeNotebookTitle(title),
    content,
    updatedAt: now,
  }
}

export function parseNotebookAgentStreamLine(line: string): NotebookAgentStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as NotebookAgentStreamEvent
  } catch {
    return null
  }
}

export function notebookAgentEventToUiItem(event: NotebookAgentStreamEvent): NotebookAgentUiItem | null {
  switch (event.type) {
    case 'thinking':
      return event.thinking?.trim() ? { type: 'thinking', text: event.thinking } : null
    case 'tool_call':
      return { type: 'tool_call', tool: event.tool ?? 'tool', toolInput: event.toolInput }
    case 'text':
      return event.text?.trim() ? { type: 'text', text: event.text } : null
    case 'error':
      return { type: 'error', text: event.error ?? 'Unknown error' }
    case 'done':
    case 'edit_proposal':
      return null
    default:
      return null
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseInlineMarkdown(value: string): string {
  let html = escapeHtml(value)

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  html = html.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')

  return html
}

function renderParagraph(lines: string[]): string {
  const content = lines.map((line) => parseInlineMarkdown(line)).join('<br />')
  return content ? `<p>${content}</p>` : ''
}

function parseTableRow(line: string): string[] | null {
  const match = line.match(/^\|(.+)\|$/)
  if (!match) return null
  return match[1]!.split('|').map((cell) => cell.trim())
}

function isTableSeparator(line: string): boolean {
  return /^\|(?:\s*:?-+:?\s*\|)+$/.test(line.trim())
}

function parseTableAlignments(line: string): ('left' | 'center' | 'right' | null)[] {
  const cells = parseTableRow(line)
  if (!cells) return []
  return cells.map((cell) => {
    const trimmed = cell.trim()
    const left = trimmed.startsWith(':')
    const right = trimmed.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

function renderTableRow(
  cells: string[],
  tag: 'td' | 'th',
  alignments?: ('left' | 'center' | 'right' | null)[],
): string {
  const cellsHtml = cells
    .map((cell, i) => {
      const align = alignments?.[i]
      const style = align ? ` style="text-align: ${align};"` : ''
      return `<${tag}${style}>${parseInlineMarkdown(cell)}</${tag}>`
    })
    .join('')
  return `<tr>${cellsHtml}</tr>`
}

export function markdownToNotebookHtml(markdown: string): string {
  const lines = markdown.replace(markdownLineBreak, '\n').split('\n')
  const blocks: string[] = []
  let paragraphLines: string[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let codeLines: string[] = []
  let inCodeBlock = false
  let tableRows: string[][] = []
  let tableAlignments: ('left' | 'center' | 'right' | null)[] = []
  let inTable = false
  let tableHasHeader = false

  const flushParagraph = (): void => {
    if (paragraphLines.length > 0) {
      const paragraph = renderParagraph(paragraphLines)
      if (paragraph) blocks.push(paragraph)
      paragraphLines = []
    }
  }

  const flushList = (): void => {
    if (listType && listItems.length > 0) {
      blocks.push(`<${listType}>${listItems.join('')}</${listType}>`)
    }
    listItems = []
    listType = null
  }

  const flushCodeBlock = (): void => {
    if (inCodeBlock) {
      blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      codeLines = []
      inCodeBlock = false
    }
  }

  const flushTable = (): void => {
    if (tableRows.length === 0) return

    let thead = ''
    let tbodyRows = tableRows

    if (tableHasHeader && tableRows.length > 0) {
      thead = `<thead>${renderTableRow(tableRows[0]!, 'th', tableAlignments)}</thead>`
      tbodyRows = tableRows.slice(1)
    }

    const tbody =
      tbodyRows.length > 0
        ? `<tbody>${tbodyRows.map((row) => renderTableRow(row, 'td', tableAlignments)).join('')}</tbody>`
        : ''

    blocks.push(`<table>${thead}${tbody}</table>`)
    tableRows = []
    tableAlignments = []
    inTable = false
    tableHasHeader = false
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    const tableRowCells = parseTableRow(line)

    if (tableRowCells) {
      if (!inTable) {
        flushParagraph()
        flushList()
        inTable = true
        tableRows = [tableRowCells]
      } else if (isTableSeparator(line)) {
        tableHasHeader = true
        tableAlignments = parseTableAlignments(line)
      } else {
        tableRows.push(tableRowCells)
      }
      continue
    }

    if (inTable) {
      flushTable()
    }

    if (line.startsWith('```')) {
      flushParagraph()
      flushList()
      if (inCodeBlock) {
        flushCodeBlock()
      } else {
        inCodeBlock = true
        codeLines = []
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(rawLine)
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      const level = headingMatch[1]!.length
      blocks.push(`<h${level}>${parseInlineMarkdown(headingMatch[2]!)}</h${level}>`)
      continue
    }

    if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
      flushParagraph()
      flushList()
      blocks.push('<hr />')
      continue
    }

    const blockquoteMatch = line.match(/^>\s+(.+)$/)
    if (blockquoteMatch) {
      flushParagraph()
      flushList()
      blocks.push(`<blockquote><p>${parseInlineMarkdown(blockquoteMatch[1]!)}</p></blockquote>`)
      continue
    }

    const unorderedMatch = line.match(/^[-*]\s+(.+)$/)
    if (unorderedMatch) {
      flushParagraph()
      if (listType && listType !== 'ul') flushList()
      listType = 'ul'
      listItems.push(`<li><p>${parseInlineMarkdown(unorderedMatch[1]!)}</p></li>`)
      continue
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/)
    if (orderedMatch) {
      flushParagraph()
      if (listType && listType !== 'ol') flushList()
      listType = 'ol'
      listItems.push(`<li><p>${parseInlineMarkdown(orderedMatch[1]!)}</p></li>`)
      continue
    }

    flushList()
    paragraphLines.push(line)
  }

  if (inTable) {
    flushTable()
  }

  flushParagraph()
  flushList()
  flushCodeBlock()

  return blocks.join('')
}

export function normalizeNotebookContent(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''
  if (htmlTagPattern.test(trimmed)) return content
  return markdownToNotebookHtml(content)
}
