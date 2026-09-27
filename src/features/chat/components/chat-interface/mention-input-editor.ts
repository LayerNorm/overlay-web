import type { ClipboardEvent, KeyboardEvent, MutableRefObject, RefObject } from 'react'
import type { MentionItem, MentionType } from '@/shared/knowledge/mention-types'
import {
  applyEditorFormat,
  buildSafeRichPasteFragment,
  createMentionChip,
  dispatchEditorInput,
  extractMarkdownFromElement,
  extractMentionsFromElement,
  getBlockContainer,
  getCaretCoords,
  getMentionQueryFromCaret,
  isCaretOnEmptyLine,
  isComposerTextEmpty,
  isEditorDomEmpty,
  markEditorEmpty,
  markdownToEditorHtml,
  MENTION_ATTR,
  moveCaretToEnd,
  removeMentionQueryText,
  resizeEditorElement,
  tryApplyBlockMarkdown,
  tryApplyInlineMarkdown,
  exitBlockToParagraph,
  type MentionInputFormatCommand,
} from './mention-input-dom'

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

type EditorRef = RefObject<HTMLDivElement | null>

export function syncEditorValue({
  editorRef,
  lastValueRef,
  onMentionsChange,
  setIsEditorEmpty,
  value,
}: {
  editorRef: EditorRef
  lastValueRef: MutableRefObject<string>
  onMentionsChange: (mentions: MentionItem[]) => void
  setIsEditorEmpty: (value: boolean) => void
  value: string
}): (() => void) | undefined {
  const el = editorRef.current
  if (!el) return undefined
  let emptyFrame = 0
  if (value === '') {
    markEditorEmpty(el)
    onMentionsChange([])
    emptyFrame = requestAnimationFrame(() => setIsEditorEmpty(true))
  } else if (value !== lastValueRef.current || el.innerHTML === '') {
    // markdownToEditorHtml escapes all user text via escapeHtml before
    // emitting markup, so this innerHTML cannot contain attacker HTML.
    // react-doctor-disable-next-line react-doctor/dangerous-html-sink
    el.innerHTML = markdownToEditorHtml(value)
    emptyFrame = requestAnimationFrame(() => setIsEditorEmpty(false))
    moveCaretToEnd(el)
  }
  lastValueRef.current = value
  resizeEditorElement(el)
  return () => {
    if (emptyFrame) cancelAnimationFrame(emptyFrame)
  }
}

export function createMentionInputHandle({
  buttonInsertedAtRef,
  editorRef,
  lastValueRef,
  onChange,
  onMentionsChange,
  setIsEditorEmpty,
}: {
  buttonInsertedAtRef: MutableRefObject<boolean>
  editorRef: EditorRef
  lastValueRef: MutableRefObject<string>
  onChange: (text: string) => void
  onMentionsChange: (mentions: MentionItem[]) => void
  setIsEditorEmpty: (value: boolean) => void
}): MentionInputHandle {
  return {
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
          // markdownToEditorHtml escapes all user text via escapeHtml before
          // emitting markup, so this innerHTML cannot contain attacker HTML.
          // react-doctor-disable-next-line react-doctor/dangerous-html-sink
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
  }
}

export function handleEditorInput({
  editorRef,
  formattingAppliedRef,
  isComposingRef,
  lastValueRef,
  onChange,
  onMentionsChange,
  runMentionSearch,
  setIsEditorEmpty,
  setMentionQuery,
  setPopupPosition,
  setShowPopup,
  suppressInputRef,
  triggerOffsetRef,
}: {
  editorRef: EditorRef
  formattingAppliedRef: MutableRefObject<boolean>
  isComposingRef: MutableRefObject<boolean>
  lastValueRef: MutableRefObject<string>
  onChange: (text: string) => void
  onMentionsChange: (mentions: MentionItem[]) => void
  runMentionSearch: (query: string) => void
  setIsEditorEmpty: (value: boolean) => void
  setMentionQuery: (value: string) => void
  setPopupPosition: (value: { x: number; y: number } | null) => void
  setShowPopup: (value: boolean) => void
  suppressInputRef: MutableRefObject<boolean>
  triggerOffsetRef: MutableRefObject<number>
}) {
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
        runMentionSearch(mentionState.query)
      }
    } else {
      setShowPopup(false)
    }
  }
}

export function syncEditorDomEmpty({
  editorRef,
  setIsEditorEmpty,
}: {
  editorRef: EditorRef
  setIsEditorEmpty: (value: boolean) => void
}) {
  const el = editorRef.current
  if (!el) return
  const empty = isEditorDomEmpty(el)
  setIsEditorEmpty(empty)
  if (empty && el.innerHTML !== '') {
    markEditorEmpty(el)
  }
}

export function selectMentionItem(
  item: MentionItem,
  {
    buttonInsertedAtRef,
    editorRef,
    lastValueRef,
    onChange,
    onMentionsChange,
    setIsEditorEmpty,
    setMentionQuery,
    setSelectedCategory,
    setShowPopup,
    triggerOffsetRef,
  }: {
    buttonInsertedAtRef: MutableRefObject<boolean>
    editorRef: EditorRef
    lastValueRef: MutableRefObject<string>
    onChange: (text: string) => void
    onMentionsChange: (mentions: MentionItem[]) => void
    setIsEditorEmpty: (value: boolean) => void
    setMentionQuery: (value: string) => void
    setSelectedCategory: (value: MentionType | null) => void
    setShowPopup: (value: boolean) => void
    triggerOffsetRef: MutableRefObject<number>
  },
) {
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
}

function handleShiftEnterInBlock(e: KeyboardEvent<HTMLDivElement>, el: HTMLDivElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed || !sel.anchorNode) return false
  const block = getBlockContainer(sel.anchorNode, el)
  if (!block || block === el) return false
  const tag = block.tagName
  // List item: check the <li> specifically
  const li = tag === 'LI' ? block : (block.parentElement?.tagName === 'LI' ? block.parentElement : null)
  if (li) {
    const liText = (li.textContent || '').replace(/\u200B/g, '').trim()
    if (liText === '') {
      // Empty list item: exit the list — split out a paragraph
      e.preventDefault()
      const list = li.parentElement
      if (list) {
        // Remove the empty <li>
        li.remove()
        // If the list is now empty, remove it and insert a <p>
        if (list.children.length === 0) {
          list.remove()
        }
        // Insert a paragraph after the list (or at end of editor)
        const p = document.createElement('p')
        p.appendChild(document.createTextNode('\u200B'))
        if (list && list.parentElement) {
          if (list.nextElementSibling) {
            list.parentElement.insertBefore(p, list.nextElementSibling)
          } else {
            list.parentElement.appendChild(p)
          }
        } else {
          el.appendChild(p)
        }
        const newRange = document.createRange()
        newRange.setStart(p.firstChild!, 0)
        newRange.collapse(true)
        sel.removeAllRanges()
        sel.addRange(newRange)
        dispatchEditorInput(el)
        return true
      }
      return false
    }
    // Non-empty list item: create a new <li> after the current one
    e.preventDefault()
    const newLi = document.createElement('li')
    newLi.appendChild(document.createElement('br'))
    if (li.nextElementSibling) {
      li.parentElement!.insertBefore(newLi, li.nextElementSibling)
    } else {
      li.parentElement!.appendChild(newLi)
    }
    const newRange = document.createRange()
    newRange.setStart(newLi, 0)
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)
    dispatchEditorInput(el)
    return true
  }
  // Blockquote: create a new line within the blockquote, or exit if
  // the caret is on an empty line
  if (tag === 'BLOCKQUOTE') {
    if (isCaretOnEmptyLine(sel)) {
      e.preventDefault()
      exitBlockToParagraph(block, sel, el)
      return true
    }
    // Non-empty line: insert a line break inside the blockquote
    e.preventDefault()
    document.execCommand('insertLineBreak')
    return true
  }
  // Code block: insert a newline within the <pre>, or exit if
  // the caret is on an empty line
  if (tag === 'PRE') {
    if (isCaretOnEmptyLine(sel)) {
      e.preventDefault()
      exitBlockToParagraph(block, sel, el)
      return true
    }
    // Non-empty line: insert a newline inside the <pre>
    e.preventDefault()
    document.execCommand('insertLineBreak')
    return true
  }
  // Headings: Shift+Enter always exits to a normal paragraph
  if (/^H[1-6]$/.test(tag)) {
    e.preventDefault()
    exitBlockToParagraph(block, sel, el)
    return true
  }
  return false
}

function handleBackspaceInBlock(e: KeyboardEvent<HTMLDivElement>, el: HTMLDivElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed || !sel.anchorNode) return false
  const block = getBlockContainer(sel.anchorNode, el)
  if (!block || block === el) return false
  const tag = block.tagName
  const li = tag === 'LI' ? block : (block.parentElement?.tagName === 'LI' ? block.parentElement : null)
  if (li) {
    const liText = (li.textContent || '').replace(/\u200B/g, '').trim()
    if (liText === '') {
      e.preventDefault()
      const list = li.parentElement
      li.remove()
      if (list && list.children.length === 0) list.remove()
      const p = document.createElement('p')
      p.appendChild(document.createTextNode('\u200B'))
      if (list && list.nextElementSibling) {
        list.parentElement!.insertBefore(p, list.nextElementSibling)
      } else if (list) {
        list.parentElement!.appendChild(p)
      } else {
        el.appendChild(p)
      }
      const newRange = document.createRange()
      newRange.setStart(p.firstChild!, 0)
      newRange.collapse(true)
      sel.removeAllRanges()
      sel.addRange(newRange)
      dispatchEditorInput(el)
      return true
    }
    return false
  }
  if (tag === 'BLOCKQUOTE') {
    if (isCaretOnEmptyLine(sel)) {
      e.preventDefault()
      exitBlockToParagraph(block, sel, el)
      return true
    }
    return false
  }
  if (tag === 'PRE') {
    if (isCaretOnEmptyLine(sel)) {
      e.preventDefault()
      exitBlockToParagraph(block, sel, el)
      return true
    }
    return false
  }
  return false
}

function removeMentionChipBeforeCaret(e: KeyboardEvent<HTMLDivElement>): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
    const prev = node.previousSibling as HTMLElement | null
    if (prev?.getAttribute?.(MENTION_ATTR)) {
      e.preventDefault()
      prev.remove()
      return true
    }
    return false
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement
    const childBefore = el.childNodes[range.startOffset - 1] as HTMLElement | undefined
    if (childBefore?.getAttribute?.(MENTION_ATTR)) {
      e.preventDefault()
      childBefore.remove()
      return true
    }
  }
  return false
}

export function handleEditorKeyDown(
  e: KeyboardEvent<HTMLDivElement>,
  {
    editorRef,
    handleInput,
    onKeyDown,
    showPopup,
  }: {
    editorRef: EditorRef
    handleInput: () => void
    onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
    showPopup: boolean
  },
) {
  // If popup is open, don't propagate Enter/Arrow keys
  if (showPopup && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape')) {
    // Let MentionPopup handle these via document listener
    return
  }

  const el = editorRef.current

  // Shift+Enter inside a list/blockquote/pre: create a new item/line.
  // On an empty item/line, exit the block instead.
  if (e.key === 'Enter' && e.shiftKey && el) {
    if (handleShiftEnterInBlock(e, el)) return
  }

  // Backspace on empty list item / blockquote / pre: exit the block
  if (e.key === 'Backspace' && el) {
    if (handleBackspaceInBlock(e, el)) return
  }

  // Handle backspace on mention chip
  if (e.key === 'Backspace' && removeMentionChipBeforeCaret(e)) {
    handleInput()
    return
  }

  onKeyDown?.(e)
}

function insertRichPasteFragment(el: HTMLDivElement, richHtml: string): boolean {
  const fragment = buildSafeRichPasteFragment(richHtml)
  if (!fragment) return false
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const lastNode = fragment.lastChild
  range.insertNode(fragment)
  if (lastNode) range.setStartAfter(lastNode)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  resizeEditorElement(el)
  dispatchEditorInput(el)
  return true
}

function insertMarkdownPaste(el: HTMLDivElement, text: string): boolean {
  // If the pasted text contains markdown syntax, parse and insert as
  // formatted HTML so the composer renders it visually.
  const hasMarkdown = /(^|\n)(#{1,3}\s|>\s|[-*]\s|\d+\.\s|```)|\*\*[^*]+\*\*|`[^`]+`|~~[^~]+~~|(^|[\s(])\*[^*\n]+\*(?=$|[\s).,!?:;])/m.test(text)
  if (!hasMarkdown) return false

  const html = markdownToEditorHtml(text)
  if (!html) return false

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
  return true
}

export function handleEditorPaste(
  e: ClipboardEvent<HTMLDivElement>,
  {
    editorRef,
    onPaste,
  }: {
    editorRef: EditorRef
    onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void
  },
) {
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

  // Rich clipboards often expose a shortened label (for example `x.com`)
  // in text/plain while keeping the exact tweet/article URL only in the
  // anchor href. Preserve that destination in the editor DOM so extraction
  // serializes portable Markdown instead of permanently storing the host.
  const richHtml = e.clipboardData.getData('text/html')
  if (richHtml && insertRichPasteFragment(el, richHtml)) return

  if (insertMarkdownPaste(el, text)) return

  // Plain text: insert without formatting
  document.execCommand('insertText', false, text)
}

export function closeMentionPopup({
  buttonInsertedAtRef,
  editorRef,
  lastValueRef,
  onChange,
  onMentionsChange,
  searchRequestRef,
  setIsEditorEmpty,
  setMentionQuery,
  setMentionSearching,
  setSelectedCategory,
  setShowPopup,
  triggerOffsetRef,
}: {
  buttonInsertedAtRef: MutableRefObject<boolean>
  editorRef: EditorRef
  lastValueRef: MutableRefObject<string>
  onChange: (text: string) => void
  onMentionsChange: (mentions: MentionItem[]) => void
  searchRequestRef: MutableRefObject<number>
  setIsEditorEmpty: (value: boolean) => void
  setMentionQuery: (value: string) => void
  setMentionSearching: (value: boolean) => void
  setSelectedCategory: (value: MentionType | null) => void
  setShowPopup: (value: boolean) => void
  triggerOffsetRef: MutableRefObject<number>
}) {
  searchRequestRef.current += 1
  setShowPopup(false)
  setMentionSearching(false)
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
}
