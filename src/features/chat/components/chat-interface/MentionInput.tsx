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

export interface MentionInputHandle {
  focus: () => void
  clear: () => void
  getPlainText: () => string
  getMentions: () => MentionItem[]
  setPlainText: (text: string) => void
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
  return isComposerTextEmpty(extractPlainTextFromElement(el))
}

function extractPlainTextFromElement(el: HTMLDivElement): string {
  let text = ''
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      if (element.getAttribute(MENTION_ATTR)) {
        text += element.textContent || ''
      } else if (element.tagName === 'BR') {
        text += '\n'
      } else if (element.tagName === 'DIV' || element.tagName === 'P') {
        if (text.length > 0 && !text.endsWith('\n')) text += '\n'
        element.childNodes.forEach(walk)
        return
      } else {
        element.childNodes.forEach(walk)
        return
      }
    }
  }
  el.childNodes.forEach(walk)
  return text
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
        el.textContent = value
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
        return extractPlainTextFromElement(editorRef.current)
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
            editorRef.current.textContent = text
            setIsEditorEmpty(false)
            moveCaretToEnd(editorRef.current)
          }
          lastValueRef.current = text
          resizeEditorElement(editorRef.current)
          onChange(text)
        }
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

      const text = extractPlainTextFromElement(el)
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
        const text = extractPlainTextFromElement(el)
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

        // For text paste, insert as plain text
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain')
        if (text) {
          document.execCommand('insertText', false, text)
        }
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
            const text = extractPlainTextFromElement(el)
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
          className={`relative w-full min-h-11 max-h-40 resize-none overflow-hidden overscroll-contain whitespace-pre-wrap break-words border-0 bg-transparent px-0.5 py-1 text-sm leading-6 text-[var(--foreground)] shadow-none outline-none ring-0 focus:ring-0 ${className || ''}`}
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
