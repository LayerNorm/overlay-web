'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { MentionPopup } from '@/components/mentions/MentionPopup'
import { useMentionData } from './useMentionData'
import type { MentionCategory, MentionItem, MentionType } from '@/shared/knowledge/mention-types'

export type MentionInputFormatCommand =
  | 'heading1'
  | 'heading2'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inlineCode'
  | 'codeBlock'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'

export interface MentionInputHandle {
  focus: () => void
  clear: () => void
  getPlainText: () => string
  getMentions: () => MentionItem[]
  setPlainText: (text: string) => void
  applyFormat: (command: MentionInputFormatCommand) => void
  getElement: () => HTMLDivElement | null
  /** Open the mention popup at the current caret without the user typing `@`. */
  openMentionPopup: () => void
}

interface MentionInputProps {
  value: string
  valueRevision?: number
  onChange: (text: string) => void
  onMentionsChange: (mentions: MentionItem[]) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void
  onUploadFile: () => void
  /** Workspace-specific targets that supplement the normal resource mentions. */
  mentionCategories?: MentionCategory[]
  placeholder?: string
  className?: string
  disabled?: boolean
}

const MENTION_ATTR = 'data-mention'
const MENTION_TYPE_ATTR = 'data-mention-type'
const MENTION_ID_ATTR = 'data-mention-id'
const MIN_EDITOR_HEIGHT = 44
const MAX_EDITOR_HEIGHT = 160

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
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  html = html.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  return html
}

function markdownToEditorHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let codeLines: string[] = []
  let inCodeBlock = false
  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(`<p>${paragraph.map(parseInlineMarkdown).join('<br />')}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (listType && listItems.length > 0) blocks.push(`<${listType}>${listItems.join('')}</${listType}>`)
    listItems = []
    listType = null
  }
  const flushCode = () => {
    if (!inCodeBlock) return
    blocks.push(`<pre>${escapeHtml(codeLines.join('\n'))}</pre>`)
    codeLines = []
    inCodeBlock = false
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.startsWith('```')) {
      flushParagraph()
      flushList()
      if (inCodeBlock) flushCode()
      else inCodeBlock = true
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
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push(`<h${heading[1]!.length}>${parseInlineMarkdown(heading[2]!)}</h${heading[1]!.length}>`)
      continue
    }
    const quote = line.match(/^>\s+(.+)$/)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push(`<blockquote>${parseInlineMarkdown(quote[1]!)}</blockquote>`)
      continue
    }
    const unordered = line.match(/^[-*]\s+(.+)$/)
    if (unordered) {
      flushParagraph()
      if (listType && listType !== 'ul') flushList()
      listType = 'ul'
      listItems.push(`<li>${parseInlineMarkdown(unordered[1]!)}</li>`)
      continue
    }
    const ordered = line.match(/^\d+\.\s+(.+)$/)
    if (ordered) {
      flushParagraph()
      if (listType && listType !== 'ol') flushList()
      listType = 'ol'
      listItems.push(`<li>${parseInlineMarkdown(ordered[1]!)}</li>`)
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  flushCode()
  return blocks.join('')
}

function inlineNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const element = node as HTMLElement
  if (element.getAttribute(MENTION_ATTR)) return element.textContent ?? ''
  if (element.tagName === 'BR') return '\n'
  const content = Array.from(element.childNodes).map(inlineNodeToMarkdown).join('')
  if (element.tagName === 'STRONG' || element.tagName === 'B') return `**${content}**`
  if (element.tagName === 'EM' || element.tagName === 'I') return `*${content}*`
  if (element.tagName === 'S' || element.tagName === 'DEL' || element.tagName === 'STRIKE') return `~~${content}~~`
  if (element.tagName === 'CODE' && element.parentElement?.tagName !== 'PRE') return `\`${content}\``
  return content
}

function blockNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const element = node as HTMLElement
  const content = Array.from(element.childNodes).map(inlineNodeToMarkdown).join('')
  if (/^H[1-3]$/.test(element.tagName)) return `${'#'.repeat(Number(element.tagName.slice(1)))} ${content}`
  if (element.tagName === 'PRE') return `\`\`\`\n${element.textContent ?? ''}\n\`\`\``
  if (element.tagName === 'BLOCKQUOTE') return content.split('\n').map((line) => `> ${line}`).join('\n')
  if (element.tagName === 'UL' || element.tagName === 'OL') {
    return Array.from(element.children).map((item, index) => {
      const itemText = Array.from(item.childNodes).map(inlineNodeToMarkdown).join('')
      return `${element.tagName === 'OL' ? `${index + 1}.` : '-'} ${itemText}`
    }).join('\n')
  }
  return content
}

function extractMarkdownFromElement(el: HTMLDivElement): string {
  return Array.from(el.childNodes)
    .map(blockNodeToMarkdown)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u00A0/g, ' ')
    .trimEnd()
}

function dispatchEditorInput(el: HTMLDivElement) {
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatBackColor' }))
}

/** Walk up from a node to the nearest block-level element within the editor root.
 * Returns the root itself if the node is a direct child (common when the editor
 * is empty or has a bare text node). */
function getBlockContainer(node: Node, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as HTMLElement
      if (/^(P|H[1-6]|BLOCKQUOTE|LI|PRE|UL|OL)$/.test(el.tagName)) return el
    }
    current = current.parentNode
  }
  // Text directly in root or in a div — treat root as the block container
  return current === root || node === root ? root : null
}

/** Check that the caret is at the start of a block (no text before it on this line). */
function isAtBlockStart(node: Node, textOffsetInNode: number, root: HTMLElement): boolean {
  const text = node.textContent || ''
  const textBefore = text.slice(0, textOffsetInNode)
  // The text before the caret on the current line must be only the trigger itself
  // (no other text before the trigger on this line)
  const lineStart = textBefore.lastIndexOf('\n') + 1
  const beforeTrigger = textBefore.slice(0, lineStart)
  if (beforeTrigger.trim().length > 0) return false

  // Walk backwards through siblings to ensure no text content before this text node
  // in the current block
  const parent = node.parentNode
  if (!parent) return false

  let sibling: Node | null = node.previousSibling
  while (sibling) {
    if (sibling.nodeType === Node.TEXT_NODE && (sibling.textContent || '').trim()) return false
    if (sibling.nodeType === Node.ELEMENT_NODE) {
      const sibEl = sibling as HTMLElement
      if (sibEl.tagName === 'BR') return true
      if (sibEl.textContent && sibEl.textContent.trim()) return false
    }
    sibling = sibling.previousSibling
  }

  // If parent is not the root, check parent's previous siblings too
  if (parent !== root && parent.nodeType === Node.ELEMENT_NODE) {
    const parentEl = parent as HTMLElement
    if (!/^(P|H[1-6]|BLOCKQUOTE|LI|PRE|UL|OL|DIV)$/.test(parentEl.tagName)) return true
    // For div wrappers, check if the div itself is at the start
    if (parentEl.tagName === 'DIV') {
      let parentSibling: Node | null = parentEl.previousSibling
      while (parentSibling) {
        if (parentSibling.nodeType === Node.TEXT_NODE && (parentSibling.textContent || '').trim()) return false
        if (parentSibling.nodeType === Node.ELEMENT_NODE) {
          const psEl = parentSibling as HTMLElement
          if (psEl.tagName === 'BR') return true
          if (psEl.textContent && psEl.textContent.trim()) return false
        }
        parentSibling = parentSibling.previousSibling
      }
    }
  }

  return true
}

/**
 * Detect block-level markdown triggers typed at the start of a line and apply
 * the corresponding block format. Returns true if a format was applied.
 *
 * Triggers: `# `, `## `, `### `, `> `, `- `, `* `, `1. `
 */
function tryApplyBlockMarkdown(el: HTMLDivElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return false

  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return false

  const text = node.textContent || ''
  const offset = range.startOffset
  const textBefore = text.slice(0, offset)

  // Get the current line text (from last newline to caret)
  const lineStart = textBefore.lastIndexOf('\n') + 1
  const lineText = textBefore.slice(lineStart)

  // Check that there's no text after the caret on this line
  const textAfter = text.slice(offset)
  if (textAfter.split('\n')[0].trim().length > 0) return false

  // Check that we're at the start of a block
  if (!isAtBlockStart(node, offset, el)) return false

  // Check that the block is not already formatted
  const block = getBlockContainer(node, el)
  if (!block) return false
  const blockTag = block.tagName
  if (blockTag !== 'DIV' && blockTag !== 'P') return false

  const blockTriggers: Array<{ pattern: RegExp; tag?: string; list?: 'ul' | 'ol' }> = [
    { pattern: /^###\s$/, tag: 'h3' },
    { pattern: /^##\s$/, tag: 'h2' },
    { pattern: /^#\s$/, tag: 'h1' },
    { pattern: /^>\s$/, tag: 'blockquote' },
    { pattern: /^[-*]\s$/, list: 'ul' },
  ]

  for (const { pattern, tag, list } of blockTriggers) {
    if (pattern.test(lineText)) {
      // Delete the trigger text using a range (handles bare text nodes in root)
      const deleteRange = document.createRange()
      deleteRange.setStart(node, lineStart)
      deleteRange.setEnd(node, offset)
      deleteRange.deleteContents()

      if (list) {
        // For lists, execCommand creates the list structure
        document.execCommand('insertUnorderedList')
      } else if (tag) {
        // For headings/quotes, manually insert a block element at the caret
        const blockEl = document.createElement(tag)
        // Insert at current caret position (which is where the trigger was)
        const insertRange = document.createRange()
        insertRange.setStart(node, lineStart)
        insertRange.collapse(true)
        insertRange.insertNode(blockEl)
        // Place caret inside the new block
        const newRange = document.createRange()
        newRange.selectNodeContents(blockEl)
        newRange.collapse(false)
        sel.removeAllRanges()
        sel.addRange(newRange)
      } else {
        // Fallback: place caret at end of editor
        const newRange = document.createRange()
        newRange.selectNodeContents(el)
        newRange.collapse(false)
        sel.removeAllRanges()
        sel.addRange(newRange)
      }
      dispatchEditorInput(el)
      return true
    }
  }

  // Ordered list: `1. `, `2. `, etc.
  if (/^\d+\.\s$/.test(lineText)) {
    const deleteRange = document.createRange()
    deleteRange.setStart(node, lineStart)
    deleteRange.setEnd(node, offset)
    deleteRange.deleteContents()
    document.execCommand('insertOrderedList')
    const newRange = document.createRange()
    newRange.selectNodeContents(el)
    newRange.collapse(false)
    sel.removeAllRanges()
    sel.addRange(newRange)
    dispatchEditorInput(el)
    return true
  }

  return false
}

/**
 * Detect inline markdown patterns as they are typed and wrap the text in the
 * appropriate element. Returns true if a format was applied.
 *
 * Patterns: `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`
 */
function tryApplyInlineMarkdown(el: HTMLDivElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return false

  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return false

  const text = node.textContent || ''
  const offset = range.startOffset
  const textBefore = text.slice(0, offset)

  // Check patterns in order — `**` before `*` to avoid false matches
  const patterns: Array<{ open: string; close: string; tag: string }> = [
    { open: '**', close: '**', tag: 'strong' },
    { open: '~~', close: '~~', tag: 's' },
    { open: '`', close: '`', tag: 'code' },
    { open: '*', close: '*', tag: 'em' },
  ]

  for (const { open, close, tag } of patterns) {
    if (!textBefore.endsWith(close)) continue

    const beforeClose = textBefore.slice(0, -close.length)
    const openIdx = beforeClose.lastIndexOf(open)
    if (openIdx === -1) continue

    const innerText = beforeClose.slice(openIdx + open.length)
    if (innerText.length === 0) continue
    // Reject if inner text starts or ends with whitespace (likely not intentional formatting)
    if (/^\s|\s$/.test(innerText)) continue
    // For single `*`, guard against matching `**` as two `*` pairs
    if (open === '*' && openIdx > 0 && textBefore[openIdx - 1] === '*') continue

    // Replace the markdown markers with a formatted element
    const replaceRange = document.createRange()
    replaceRange.setStart(node, openIdx)
    replaceRange.setEnd(node, openIdx + open.length + innerText.length + close.length)
    replaceRange.deleteContents()

    const wrapper = document.createElement(tag)
    wrapper.textContent = innerText
    replaceRange.insertNode(wrapper)

    // Place caret after the wrapper
    const newRange = document.createRange()
    newRange.setStartAfter(wrapper)
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)

    dispatchEditorInput(el)
    return true
  }

  return false
}

function toggleInlineCode(el: HTMLDivElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  if (!el.contains(range.commonAncestorContainer)) return
  const existing = range.commonAncestorContainer.parentElement?.closest('code')
  if (existing && el.contains(existing)) {
    existing.replaceWith(...Array.from(existing.childNodes))
    return
  }
  if (range.collapsed) return
  const wrapper = document.createElement('code')
  try {
    range.surroundContents(wrapper)
  } catch {
    wrapper.appendChild(range.extractContents())
    range.insertNode(wrapper)
  }
}

function applyEditorFormat(el: HTMLDivElement, command: MentionInputFormatCommand) {
  el.focus()
  const blockCommand = (tag: 'h1' | 'h2' | 'pre' | 'blockquote') => {
    const current = String(document.queryCommandValue('formatBlock')).toLowerCase().replace(/[<>]/g, '')
    document.execCommand('formatBlock', false, current === tag ? 'div' : tag)
  }
  if (command === 'bold') document.execCommand('bold')
  else if (command === 'italic') document.execCommand('italic')
  else if (command === 'strike') document.execCommand('strikeThrough')
  else if (command === 'inlineCode') toggleInlineCode(el)
  else if (command === 'codeBlock') blockCommand('pre')
  else if (command === 'heading1') blockCommand('h1')
  else if (command === 'heading2') blockCommand('h2')
  else if (command === 'blockquote') blockCommand('blockquote')
  else if (command === 'bulletList') document.execCommand('insertUnorderedList')
  else if (command === 'orderedList') document.execCommand('insertOrderedList')
  dispatchEditorInput(el)
}

function resizeEditorElement(el: HTMLDivElement) {
  const savedScrollTop = el.scrollTop
  el.style.height = 'auto'
  const nextHeight = Math.min(Math.max(el.scrollHeight, MIN_EDITOR_HEIGHT), MAX_EDITOR_HEIGHT)
  el.style.height = `${nextHeight}px`
  el.style.overflowY = el.scrollHeight > MAX_EDITOR_HEIGHT ? 'auto' : 'hidden'

  if (el.scrollHeight <= MAX_EDITOR_HEIGHT) return

  el.scrollTop = savedScrollTop
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return

  const caretRect = sel.getRangeAt(0).getBoundingClientRect()
  if (caretRect.width === 0 && caretRect.height === 0) return

  const elRect = el.getBoundingClientRect()
  if (caretRect.bottom > elRect.bottom) {
    el.scrollTop += caretRect.bottom - elRect.bottom + 4
  } else if (caretRect.top < elRect.top) {
    el.scrollTop -= elRect.top - caretRect.top
  }
}

function createMentionChip(item: MentionItem): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.contentEditable = 'false'
  chip.setAttribute(MENTION_ATTR, 'true')
  chip.setAttribute(MENTION_TYPE_ATTR, item.type)
  chip.setAttribute(MENTION_ID_ATTR, item.id)
  chip.className =
    'inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded-md bg-[var(--surface-muted)] border border-[var(--border)] text-xs font-medium text-[var(--foreground)] select-none align-baseline'
  chip.textContent = `@${item.name}`
  // Store full item data
  chip.dataset.mentionData = JSON.stringify(item)
  return chip
}

function extractMentionsFromElement(el: HTMLDivElement): MentionItem[] {
  const chips = el.querySelectorAll(`[${MENTION_ATTR}]`)
  const mentions: MentionItem[] = []
  chips.forEach((chip) => {
    try {
      const data = (chip as HTMLElement).dataset.mentionData
      if (data) mentions.push(JSON.parse(data))
    } catch {
      // skip malformed
    }
  })
  return mentions
}

/** True when the editor has no user-visible text (ignores lone newlines from empty `<br>`). */
function isComposerTextEmpty(text: string): boolean {
  return text.replace(/\u00A0/g, ' ').trim().length === 0
}

function isEditorDomEmpty(el: HTMLDivElement): boolean {
  return isComposerTextEmpty(extractMarkdownFromElement(el))
}

function moveCaretToEnd(el: HTMLDivElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function markEditorEmpty(el: HTMLDivElement) {
  el.innerHTML = ''
}

function getCaretCoords(): { x: number; y: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0).cloneRange()
  range.collapse(true)
  const rect = range.getBoundingClientRect()
  // If rect is 0,0 (e.g. empty line), use parent element rect
  if (rect.x === 0 && rect.y === 0) {
    const parent = range.startContainer.parentElement
    if (parent) {
      const parentRect = parent.getBoundingClientRect()
      return { x: parentRect.x, y: parentRect.y }
    }
    return null
  }
  return { x: rect.x, y: rect.y }
}

function getMentionQueryFromCaret(el: HTMLDivElement): { query: string; triggerOffset: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return null

  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return null

  const text = node.textContent || ''
  const offset = range.startOffset
  const textBefore = text.slice(0, offset)

  // Find the last @ that is either at position 0 or preceded by whitespace
  const atIdx = textBefore.lastIndexOf('@')
  if (atIdx === -1) return null
  if (atIdx > 0 && textBefore[atIdx - 1] !== ' ' && textBefore[atIdx - 1] !== '\n') return null

  const query = textBefore.slice(atIdx + 1)
  // If there's a space in the query, the mention is likely done
  if (query.includes(' ') && query.length > 20) return null

  return { query, triggerOffset: atIdx }
}

function removeMentionQueryText(el: HTMLDivElement, triggerOffset: number) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return

  const text = node.textContent || ''
  const offset = range.startOffset
  // Remove from @ to current cursor position
  node.textContent = text.slice(0, triggerOffset) + text.slice(offset)
  // Place cursor after the position where we'll insert the chip
  const newRange = document.createRange()
  newRange.setStart(node, triggerOffset)
  newRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(newRange)
}

export const MentionInput = forwardRef<MentionInputHandle, MentionInputProps>(
  function MentionInput(
    {
      value,
      valueRevision,
      onChange,
      onMentionsChange,
      onKeyDown,
      onPaste,
      onUploadFile,
      mentionCategories = [],
      placeholder,
      className,
      disabled,
    },
    ref
  ) {
    const editorRef = useRef<HTMLDivElement>(null)
    const [showPopup, setShowPopup] = useState(false)
    const [mentionQuery, setMentionQuery] = useState('')
    const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null)
    const [categories, setCategories] = useState<MentionCategory[]>([])
    const [selectedCategory, setSelectedCategory] = useState<MentionType | null>(null)
    const triggerOffsetRef = useRef<number>(0)
    const isComposingRef = useRef(false)
    const suppressInputRef = useRef(false)
    const lastValueRef = useRef(value)
    /** Guards against recursive handleInput calls from dispatchEditorInput in live markdown formatting. */
    const formattingAppliedRef = useRef(false)
    /** True when the @ that opened the current popup was inserted by the @ button rather
     * than typed by the user; on close-without-select we strip that orphan @. */
    const buttonInsertedAtRef = useRef(false)
    const [isEditorEmpty, setIsEditorEmpty] = useState(() => isComposerTextEmpty(value))

    const {
      availableTypes: defaultAvailableTypes,
      search: searchDefaultCategories,
      loading,
    } = useMentionData()
    const availableTypes = useMemo(() => Array.from(new Set([
      ...defaultAvailableTypes,
      ...mentionCategories.map((category) => category.type),
    ])), [defaultAvailableTypes, mentionCategories])
    const search = useCallback(async (query: string): Promise<MentionCategory[]> => {
      const defaultCategories = await searchDefaultCategories(query)
      const normalizedQuery = query.trim().toLocaleLowerCase()
      const extraCategories = mentionCategories.map((category) => ({
        ...category,
        items: normalizedQuery
          ? category.items.filter((item) => (`${item.name} ${item.description ?? ''}`).toLocaleLowerCase().includes(normalizedQuery))
          : category.items,
      })).filter((category) => category.items.length > 0)
      const byType = new Map(defaultCategories.map((category) => [category.type, category]))
      for (const category of extraCategories) byType.set(category.type, category)
      return Array.from(byType.values())
    }, [mentionCategories, searchDefaultCategories])

    // Sync explicit external value commands into the editor (clear on send,
    // populate restored draft after hydration). Normal typing stays local to
    // the contenteditable so the chat surface does not re-render per key.
    useEffect(() => {
      const el = editorRef.current
      if (!el) return
      let emptyFrame = 0
      if (value === '') {
        markEditorEmpty(el)
        onMentionsChange([])
        emptyFrame = requestAnimationFrame(() => setIsEditorEmpty(true))
      } else if (value !== lastValueRef.current || el.innerHTML === '') {
        el.innerHTML = markdownToEditorHtml(value)
        emptyFrame = requestAnimationFrame(() => setIsEditorEmpty(false))
        moveCaretToEnd(el)
      }
      lastValueRef.current = value
      resizeEditorElement(el)
      return () => {
        if (emptyFrame) cancelAnimationFrame(emptyFrame)
      }
    }, [value, valueRevision, onMentionsChange])

    useImperativeHandle(ref, () => ({
      focus: () => {
        const el = editorRef.current
        if (!el) return
        el.focus()
        moveCaretToEnd(el)
      },
      clear: () => {
        if (editorRef.current) {
          markEditorEmpty(editorRef.current)
          resizeEditorElement(editorRef.current)
          lastValueRef.current = ''
          setIsEditorEmpty(true)
          onChange('')
          onMentionsChange([])
        }
      },
      getPlainText: () => {
        if (!editorRef.current) return ''
        return extractMarkdownFromElement(editorRef.current)
      },
      getMentions: () => {
        if (!editorRef.current) return []
        return extractMentionsFromElement(editorRef.current)
      },
      setPlainText: (text: string) => {
        if (editorRef.current) {
          if (text.length === 0) {
            markEditorEmpty(editorRef.current)
            setIsEditorEmpty(true)
          } else {
            editorRef.current.innerHTML = markdownToEditorHtml(text)
            setIsEditorEmpty(false)
            moveCaretToEnd(editorRef.current)
          }
          lastValueRef.current = text
          resizeEditorElement(editorRef.current)
          onChange(text)
        }
      },
      applyFormat: (command) => {
        if (editorRef.current) applyEditorFormat(editorRef.current, command)
      },
      getElement: () => editorRef.current,
      openMentionPopup: () => {
        const el = editorRef.current
        if (!el) return
        el.focus()
        // Ensure caret is positioned somewhere inside the editor.
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
          const range = document.createRange()
          range.selectNodeContents(el)
          range.collapse(false) // place at end
          sel?.removeAllRanges()
          sel?.addRange(range)
        }
        // Insert "@" at the caret. If the previous char is not whitespace, prepend a space
        // so getMentionQueryFromCaret recognises the new @ as a mention trigger.
        let prefix = ''
        const sel2 = window.getSelection()
        if (sel2 && sel2.rangeCount > 0) {
          const range = sel2.getRangeAt(0)
          const node = range.startContainer
          if (node.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
            const prevChar = (node.textContent || '')[range.startOffset - 1]
            if (prevChar && prevChar !== ' ' && prevChar !== '\n' && prevChar !== '\u00A0') {
              prefix = ' '
            }
          }
        }
        document.execCommand('insertText', false, `${prefix}@`)
        buttonInsertedAtRef.current = true
        // Trigger input handling so the popup opens (input event already fires from
        // execCommand, but we make it explicit in case the browser does not).
      },
    }))

    const handleInput = useCallback(() => {
      if (suppressInputRef.current) return
      const el = editorRef.current
      if (!el) return

      // Live markdown: attempt block and inline formatting before extracting text.
      // These calls dispatch a new input event when they apply a format, which
      // re-enters handleInput — the formattingAppliedRef guard prevents infinite
      // recursion by skipping the formatting attempt on the re-entrant call.
      if (!formattingAppliedRef.current) {
        formattingAppliedRef.current = true
        const applied = tryApplyBlockMarkdown(el) || tryApplyInlineMarkdown(el)
        formattingAppliedRef.current = false
        if (applied) return // The dispatched input event will re-run handleInput
      }

      const text = extractMarkdownFromElement(el)
      const empty = isComposerTextEmpty(text)
      lastValueRef.current = empty ? '' : text
      if (!isComposingRef.current) {
        if (empty) {
          if (el.innerHTML !== '') {
            markEditorEmpty(el)
          }
          setIsEditorEmpty(true)
        } else {
          setIsEditorEmpty(false)
        }
      }
      resizeEditorElement(el)
      onChange(empty ? '' : text)
      onMentionsChange(extractMentionsFromElement(el))

      // Check for @ trigger
      if (!isComposingRef.current) {
        const mentionState = getMentionQueryFromCaret(el)
        if (mentionState) {
          setMentionQuery(mentionState.query)
          triggerOffsetRef.current = mentionState.triggerOffset
          const coords = getCaretCoords()
          if (coords) {
            setPopupPosition(coords)
            setShowPopup(true)
            void search(mentionState.query).then(setCategories)
          }
        } else {
          setShowPopup(false)
        }
      }
    }, [onChange, onMentionsChange, search])

    const syncEditorEmptyState = useCallback(() => {
      const el = editorRef.current
      if (!el) return
      const empty = isEditorDomEmpty(el)
      setIsEditorEmpty(empty)
      if (empty && el.innerHTML !== '') {
        markEditorEmpty(el)
      }
    }, [])

    // Search when mentionQuery changes
    useEffect(() => {
      if (!showPopup) return
      void search(mentionQuery).then(setCategories)
    }, [mentionQuery, showPopup, search])

    const handleSelect = useCallback(
      (item: MentionItem) => {
        const el = editorRef.current
        if (!el) return

        // Remove the @query text
        removeMentionQueryText(el, triggerOffsetRef.current)

        // Insert mention chip
        const chip = createMentionChip(item)
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0)
          range.insertNode(chip)
          // Move cursor after chip
          range.setStartAfter(chip)
          range.collapse(true)
          sel.removeAllRanges()
          sel.addRange(range)
          // Insert a space after the chip
          const space = document.createTextNode('\u00A0')
          range.insertNode(space)
          range.setStartAfter(space)
          range.collapse(true)
          sel.removeAllRanges()
          sel.addRange(range)
        }

        setShowPopup(false)
        setMentionQuery('')
        setSelectedCategory(null)
        // Successful selection consumed the @<query> via removeMentionQueryText above,
        // so the orphan-strip path in closePopup must not run.
        buttonInsertedAtRef.current = false

        // Update state
        const text = extractMarkdownFromElement(el)
        const empty = isComposerTextEmpty(text)
        lastValueRef.current = empty ? '' : text
        setIsEditorEmpty(empty)
        if (empty && el.innerHTML !== '') {
          markEditorEmpty(el)
        }
        resizeEditorElement(el)
        onChange(empty ? '' : text)
        onMentionsChange(extractMentionsFromElement(el))
      },
      [onChange, onMentionsChange]
    )

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        // If popup is open, don't propagate Enter/Arrow keys
        if (showPopup && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape')) {
          // Let MentionPopup handle these via document listener
          return
        }

        // Handle backspace on mention chip
        if (e.key === 'Backspace') {
          const sel = window.getSelection()
          if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
            const range = sel.getRangeAt(0)
            const node = range.startContainer
            if (node.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
              const prev = node.previousSibling as HTMLElement | null
              if (prev?.getAttribute?.(MENTION_ATTR)) {
                e.preventDefault()
                prev.remove()
                handleInput()
                return
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as HTMLElement
              const childBefore = el.childNodes[range.startOffset - 1] as HTMLElement | undefined
              if (childBefore?.getAttribute?.(MENTION_ATTR)) {
                e.preventDefault()
                childBefore.remove()
                handleInput()
                return
              }
            }
          }
        }

        onKeyDown?.(e)
      },
      [showPopup, onKeyDown, handleInput]
    )

    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLDivElement>) => {
        onPaste?.(e)
        if (e.defaultPrevented) {
          return
        }

        e.preventDefault()
        const text = e.clipboardData.getData('text/plain')
        if (!text) return

        const el = editorRef.current
        if (!el) {
          document.execCommand('insertText', false, text)
          return
        }

        // If the pasted text contains markdown syntax, parse and insert as
        // formatted HTML so the composer renders it visually.
        const hasMarkdown = /(^|\n)(#{1,3}\s|>\s|[-*]\s|\d+\.\s|```)|\*\*[^*]+\*\*|`[^`]+`|~~[^~]+~~|(^|[\s(])\*[^*\n]+\*(?=$|[\s).,!?:;])/m.test(text)

        if (hasMarkdown) {
          const html = markdownToEditorHtml(text)
          if (html) {
            const template = document.createElement('template')
            template.innerHTML = html
            const fragment = template.content

            const sel = window.getSelection()
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0)
              range.deleteContents()
              range.insertNode(fragment)
              // Move caret to end of inserted content
              const lastChild = el.lastElementChild
              if (lastChild) {
                const newRange = document.createRange()
                newRange.selectNodeContents(lastChild)
                newRange.collapse(false)
                sel.removeAllRanges()
                sel.addRange(newRange)
              }
            } else {
              document.execCommand('insertText', false, text)
            }
            resizeEditorElement(el)
            dispatchEditorInput(el)
            return
          }
        }

        // Plain text: insert without formatting
        document.execCommand('insertText', false, text)
      },
      [onPaste]
    )

    const closePopup = useCallback(() => {
      setShowPopup(false)
      setMentionQuery('')
      setSelectedCategory(null)
      // If the @ was inserted by the button and no item was selected, strip the
      // orphan @<query> from the editor.
      if (buttonInsertedAtRef.current) {
        buttonInsertedAtRef.current = false
        const el = editorRef.current
        if (el) {
          try {
            removeMentionQueryText(el, triggerOffsetRef.current)
            const text = extractMarkdownFromElement(el)
            lastValueRef.current = text
            const empty = isComposerTextEmpty(text)
            lastValueRef.current = empty ? '' : text
            setIsEditorEmpty(empty)
            if (empty && el.innerHTML !== '') {
              markEditorEmpty(el)
            }
            resizeEditorElement(el)
            onChange(empty ? '' : text)
            onMentionsChange(extractMentionsFromElement(el))
          } catch {
            // Best-effort cleanup; ignore failures.
          }
        }
      }
    }, [onChange, onMentionsChange])

    return (
      <div className="relative w-full">
        {isEditorEmpty && placeholder ? (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 px-0.5 py-1 text-sm leading-6 text-[var(--muted-light)] select-none whitespace-pre-wrap break-words"
            aria-hidden
          >
            {placeholder}
          </div>
        ) : null}
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={handleInput}
          onFocus={syncEditorEmptyState}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => {
            isComposingRef.current = false
            handleInput()
          }}
          data-placeholder={placeholder}
          className={`relative w-full min-h-11 max-h-40 resize-none overflow-hidden overscroll-contain whitespace-pre-wrap break-words border-0 bg-transparent px-0.5 py-1 text-sm leading-6 text-[var(--foreground)] shadow-none outline-none ring-0 focus:ring-0 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--muted)] [&_code]:rounded [&_code]:bg-[var(--surface-subtle)] [&_code]:px-1 [&_code]:font-mono [&_h1]:my-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:my-1 [&_h2]:text-lg [&_h2]:font-semibold [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-0 [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-[var(--surface-subtle)] [&_pre]:px-3 [&_pre]:py-2 [&_pre]:font-mono [&_strong]:font-semibold [&_ul]:ml-5 [&_ul]:list-disc ${className || ''}`}
          role="textbox"
          aria-multiline="true"
          aria-placeholder={placeholder}
        />
        {showPopup && (
          <MentionPopup
            categories={categories}
            loading={loading}
            position={popupPosition}
            onSelect={handleSelect}
            onUploadFile={() => {
              closePopup()
              onUploadFile()
            }}
            onClose={closePopup}
            query={mentionQuery}
            availableTypes={availableTypes}
            selectedCategory={selectedCategory}
            onSelectedCategoryChange={setSelectedCategory}
          />
        )}
      </div>
    )
  }
)
