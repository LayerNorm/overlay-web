import type { Heading } from 'mdast'
import { toString } from 'mdast-util-to-string'
import { parseNoteMarkdown } from './note-markdown'

/**
 * Patch-style edits over a Markdown note, so agents change a note without
 * regenerating it. Every function is pure and throws `NoteEditError` with a
 * message written for the model that asked for the edit.
 */

export class NoteEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoteEditError'
  }
}

export interface NoteHeading {
  level: number
  text: string
}

interface LocatedHeading extends NoteHeading {
  start: number
  end: number
}

function locateHeadings(markdown: string): LocatedHeading[] {
  const tree = parseNoteMarkdown(markdown)
  const headings: LocatedHeading[] = []
  for (const node of tree.children) {
    if (node.type !== 'heading') continue
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) continue
    headings.push({ level: (node as Heading).depth, text: toString(node).trim(), start, end })
  }
  return headings
}

export function noteOutline(markdown: string): NoteHeading[] {
  return locateHeadings(markdown).map(({ level, text }) => ({ level, text }))
}

function normalizeHeading(value: string): string {
  return value.replace(/^#+\s*/, '').trim().toLowerCase()
}

function joinBlocks(...parts: string[]): string {
  const blocks = parts.map((part) => part.trim()).filter(Boolean)
  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : ''
}

export function appendToNote(markdown: string, addition: string): string {
  if (!addition.trim()) throw new NoteEditError('Nothing to append: content is empty.')
  return joinBlocks(markdown, addition)
}

export function prependToNote(markdown: string, addition: string): string {
  if (!addition.trim()) throw new NoteEditError('Nothing to prepend: content is empty.')
  return joinBlocks(addition, markdown)
}

/**
 * Replaces the body under `heading` (up to the next heading of the same or a
 * higher level) and keeps the heading line itself. With `appendIfMissing`, a
 * missing section is added at the end as a level-2 heading.
 */
export function replaceNoteSection(
  markdown: string,
  heading: string,
  content: string,
  options: { appendIfMissing?: boolean } = {},
): string {
  const target = normalizeHeading(heading)
  if (!target) throw new NoteEditError('heading is required.')
  const headings = locateHeadings(markdown)
  const matches = headings.filter((candidate) => candidate.text.toLowerCase() === target)
  if (matches.length === 0) {
    if (options.appendIfMissing) return joinBlocks(markdown, `## ${heading.replace(/^#+\s*/, '').trim()}`, content)
    const available = headings.map((candidate) => `${'#'.repeat(candidate.level)} ${candidate.text}`)
    throw new NoteEditError(
      available.length > 0
        ? `No heading "${heading}" in this note. Headings: ${available.join(' | ')}`
        : `No heading "${heading}" in this note; it has no headings.`,
    )
  }
  if (matches.length > 1) {
    throw new NoteEditError(`The heading "${heading}" appears ${matches.length} times; use edit_note with a unique find string instead.`)
  }
  const match = matches[0]!
  const next = headings.find((candidate) => candidate.start > match.start && candidate.level <= match.level)
  const before = markdown.slice(0, match.end)
  const after = next ? markdown.slice(next.start) : ''
  return joinBlocks(before, content, after)
}

export interface NoteFindReplace {
  find: string
  replace: string
  replaceAll?: boolean
}

/** Applies exact-text replacements in order; each `find` must match once unless `replaceAll`. */
export function applyNoteEdits(markdown: string, edits: readonly NoteFindReplace[]): string {
  if (edits.length === 0) throw new NoteEditError('edits must contain at least one change.')
  let next = markdown
  edits.forEach((edit, index) => {
    const label = edits.length > 1 ? `Edit ${index + 1}: ` : ''
    if (!edit.find) throw new NoteEditError(`${label}find must not be empty.`)
    const count = next.split(edit.find).length - 1
    if (count === 0) {
      throw new NoteEditError(`${label}the text to find was not in the note. Re-read the note with get_note and copy the text exactly.`)
    }
    if (count > 1 && !edit.replaceAll) {
      throw new NoteEditError(`${label}the text to find appears ${count} times. Include more surrounding text, or set replaceAll.`)
    }
    next = edit.replaceAll ? next.split(edit.find).join(edit.replace) : next.replace(edit.find, () => edit.replace)
  })
  return next
}
