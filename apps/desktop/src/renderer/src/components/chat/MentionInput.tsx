/**
 * MentionInput — contentEditable chat editor with inline @ mention chips.
 *
 * Direct port of the web app's MentionInput
 * (src/features/chat/components/chat-interface/MentionInput.tsx), backed by
 * desktop data sources (window.bridge.knowledge.mentionSearch + workspace file
 * listing). Renders MentionPopup at the caret when the user types `@`.
 *
 * Must be rendered inside a `.shared-chat-scope` element so CSS variables
 * (--foreground, --muted-light, --surface-muted, ...) resolve.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import { MentionPopup, MENTION_CATEGORY_ORDER, type MentionCategoryResult } from './MentionPopup'

// ── Types ───────────────────────────────────────────────────────────────────────

export type MentionType = 'note' | 'chat' | 'document' | 'file'

export interface Mention {
  id: string
  type: MentionType
  title: string
  preview?: string
  folderId?: string
  filename?: string
  filepath?: string
}

export interface MentionInputHandle {
  focus: () => void
  clear: () => void
  getPlainText: () => string
  getMentions: () => Mention[]
  setPlainText: (text: string) => void
  getElement: () => HTMLDivElement | null
  /** Open the mention popup at the current caret without the user typing `@`. */
  openMentionPopup: () => void
}

interface MentionInputProps {
  value: string
  valueRevision?: number
  onChange: (text: string) => void
  onMentionsChange: (mentions: Mention[]) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void
  onUploadFile: () => void
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Folder scoping for knowledge searches. */
  folderId?: string
  /** Working folder enabling @file mentions. */
  workingFolder?: string | null
  onPopupVisibleChange?: (visible: boolean) => void
}

const MENTION_ATTR = 'data-mention'
const MENTION_TYPE_ATTR = 'data-mention-type'
const MENTION_ID_ATTR = 'data-mention-id'
const MIN_EDITOR_HEIGHT = 44
const MAX_EDITOR_HEIGHT = 160

// ── Editor DOM helpers (ported from web) ───────────────────────────────────────

function resizeEditorElement(el: HTMLDivElement): void {
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

function createMentionChip(item: Mention): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.contentEditable = 'false'
  chip.setAttribute(MENTION_ATTR, 'true')
  chip.setAttribute(MENTION_TYPE_ATTR, item.type)
  chip.setAttribute(MENTION_ID_ATTR, item.id)
  chip.className =
    'inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded-md bg-[var(--surface-muted)] border border-[var(--border)] text-xs font-medium text-[var(--foreground)] select-none align-baseline'
  chip.textContent = `@${item.title}`
  chip.dataset.mentionData = JSON.stringify(item)
  return chip
}

function extractMentionsFromElement(el: HTMLDivElement): Mention[] {
  const chips = el.querySelectorAll(`[${MENTION_ATTR}]`)
  const mentions: Mention[] = []
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
  const walk = (node: Node): void => {
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

function moveCaretToEnd(el: HTMLDivElement): void {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function markEditorEmpty(el: HTMLDivElement): void {
  el.innerHTML = ''
}

function getCaretCoords(): { x: number; y: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0).cloneRange()
  range.collapse(true)
  const rect = range.getBoundingClientRect()
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

function getMentionQueryFromCaret(
  el: HTMLDivElement
): { query: string; triggerOffset: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return null

  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return null

  const text = node.textContent || ''
  const offset = range.startOffset
  const textBefore = text.slice(0, offset)

  const atIdx = textBefore.lastIndexOf('@')
  if (atIdx === -1) return null
  if (atIdx > 0 && textBefore[atIdx - 1] !== ' ' && textBefore[atIdx - 1] !== '\n') return null

  const query = textBefore.slice(atIdx + 1)
  if (query.includes(' ') && query.length > 20) return null

  return { query, triggerOffset: atIdx }
}

function removeMentionQueryText(el: HTMLDivElement, triggerOffset: number): void {
  void el
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return

  const text = node.textContent || ''
  const offset = range.startOffset
  node.textContent = text.slice(0, triggerOffset) + text.slice(offset)
  const newRange = document.createRange()
  newRange.setStart(node, triggerOffset)
  newRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(newRange)
}

// ── Desktop mention search (bridge-backed) ─────────────────────────────────────

function useDesktopMentionSearch(
  folderId: string | undefined,
  workingFolder: string | null | undefined
): {
  search: (query: string, category: MentionType | null) => Promise<MentionCategoryResult[]>
  loading: boolean
} {
  const [loading, setLoading] = useState(false)
  const fileListCacheRef = useRef<{ folder: string; paths: string[] } | null>(null)

  const searchFiles = useCallback(
    async (query: string): Promise<Mention[]> => {
      if (!workingFolder) return []
      let paths: string[] = []
      if (fileListCacheRef.current?.folder === workingFolder) {
        paths = fileListCacheRef.current.paths
      } else {
        const result = await window.bridge.workspace.listFiles(workingFolder, 4)
        if (result.success) {
          paths = result.paths
          fileListCacheRef.current = { folder: workingFolder, paths }
        }
      }
      const q = query.toLowerCase()
      return paths
        .filter((p) => !q || p.toLowerCase().includes(q))
        .slice(0, 10)
        .map((relativePath) => {
          const parts = relativePath.split('/')
          const filename = parts[parts.length - 1]
          return {
            id: relativePath,
            type: 'file' as MentionType,
            title: filename,
            preview: relativePath,
            filepath: `${workingFolder}/${relativePath}`
          }
        })
    },
    [workingFolder]
  )

  const searchKnowledge = useCallback(
    async (query: string, type: 'note' | 'chat' | 'document'): Promise<Mention[]> => {
      try {
        const results = await window.bridge.knowledge.mentionSearch({
          query,
          type,
          folderId,
          limit: 8
        })
        return (results as Array<Mention & { score?: number }>).map((result) => ({
          id: result.id,
          type: result.type,
          title: result.title,
          preview: result.preview,
          folderId: result.folderId,
          filename: result.filename
        }))
      } catch {
        return []
      }
    },
    [folderId]
  )

  const search = useCallback(
    async (query: string, category: MentionType | null): Promise<MentionCategoryResult[]> => {
      setLoading(true)
      try {
        const types: MentionType[] = category
          ? [category]
          : MENTION_CATEGORY_ORDER.map((c) => c.type).filter(
              (t) => t !== 'file' || !!workingFolder
            )
        const results = await Promise.all(
          types.map(async (type): Promise<MentionCategoryResult> => {
            if (type === 'file') return { type, items: await searchFiles(query) }
            const items = await searchKnowledge(query, type)
            return { type, items: category ? items : items.slice(0, 4) }
          })
        )
        return results.filter((cat) => cat.items.length > 0 || cat.type === category)
      } finally {
        setLoading(false)
      }
    },
    [searchFiles, searchKnowledge, workingFolder]
  )

  return { search, loading }
}

// ── Component ───────────────────────────────────────────────────────────────────

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
      placeholder,
      className,
      disabled,
      folderId,
      workingFolder,
      onPopupVisibleChange
    },
    ref
  ) {
    const editorRef = useRef<HTMLDivElement>(null)
    const [showPopup, setShowPopup] = useState(false)
    const [mentionQuery, setMentionQuery] = useState('')
    const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null)
    const [categories, setCategories] = useState<MentionCategoryResult[]>([])
    const [selectedCategory, setSelectedCategory] = useState<MentionType | null>(null)
    const triggerOffsetRef = useRef<number>(0)
    const isComposingRef = useRef(false)
    const lastValueRef = useRef(value)
    /** True when the @ that opened the current popup was inserted by the @ button rather
     * than typed by the user; on close-without-select we strip that orphan @. */
    const buttonInsertedAtRef = useRef(false)
    const [isEditorEmpty, setIsEditorEmpty] = useState(() => isComposerTextEmpty(value))

    const { search, loading } = useDesktopMentionSearch(folderId, workingFolder)

    const availableTypes = MENTION_CATEGORY_ORDER.map((c) => c.type).filter(
      (t) => t !== 'file' || !!workingFolder
    )

    useEffect(() => {
      onPopupVisibleChange?.(showPopup)
    }, [showPopup, onPopupVisibleChange])

    // Sync explicit external value commands into the editor (clear on send,
    // programmatic setValue). Normal typing stays local to the contenteditable.
    useEffect(() => {
      const el = editorRef.current
      if (!el) return
      let emptyFrame = 0
      if (value === '') {
        if (lastValueRef.current !== '' || el.innerHTML !== '') {
          markEditorEmpty(el)
          onMentionsChange([])
          emptyFrame = requestAnimationFrame(() => setIsEditorEmpty(true))
        }
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
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
          const range = document.createRange()
          range.selectNodeContents(el)
          range.collapse(false)
          sel?.removeAllRanges()
          sel?.addRange(range)
        }
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
      }
    }))

    const handleInput = useCallback(() => {
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
          }
        } else {
          setShowPopup(false)
        }
      }
    }, [onChange, onMentionsChange])

    const syncEditorEmptyState = useCallback(() => {
      const el = editorRef.current
      if (!el) return
      const empty = isEditorDomEmpty(el)
      setIsEditorEmpty(empty)
      if (empty && el.innerHTML !== '') {
        markEditorEmpty(el)
      }
    }, [])

    // Search when the query or category changes while the popup is open
    useEffect(() => {
      if (!showPopup) return
      let cancelled = false
      void search(mentionQuery, selectedCategory).then((results) => {
        if (!cancelled) setCategories(results)
      })
      return () => {
        cancelled = true
      }
    }, [mentionQuery, showPopup, selectedCategory, search])

    const handleSelect = useCallback(
      (item: Mention) => {
        const el = editorRef.current
        if (!el) return

        removeMentionQueryText(el, triggerOffsetRef.current)

        const chip = createMentionChip(item)
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0)
          range.insertNode(chip)
          range.setStartAfter(chip)
          range.collapse(true)
          sel.removeAllRanges()
          sel.addRange(range)
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
        buttonInsertedAtRef.current = false

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
        // If popup is open, let MentionPopup's document listener handle these keys
        if (
          showPopup &&
          (e.key === 'ArrowUp' ||
            e.key === 'ArrowDown' ||
            e.key === 'Enter' ||
            e.key === 'Tab' ||
            e.key === 'Escape')
        ) {
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
            className="pointer-events-none absolute inset-x-0 top-0 select-none whitespace-pre-wrap break-words px-0.5 py-1 text-sm leading-6 text-[var(--muted-light)]"
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
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
            handleInput()
          }}
          data-placeholder={placeholder}
          className={`relative max-h-40 min-h-11 w-full resize-none overflow-hidden overscroll-contain whitespace-pre-wrap break-words border-0 bg-transparent px-0.5 py-1 text-sm leading-6 text-[var(--foreground)] shadow-none outline-none ring-0 focus:ring-0 ${className || ''}`}
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
            selectedCategory={selectedCategory}
            onSelectedCategoryChange={setSelectedCategory}
            availableTypes={availableTypes}
          />
        )}
      </div>
    )
  }
)
