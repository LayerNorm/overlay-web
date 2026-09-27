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
import { isComposerTextEmpty } from './mention-input-dom'
import {
  closeMentionPopup,
  createMentionInputHandle,
  handleEditorInput,
  handleEditorKeyDown,
  handleEditorPaste,
  selectMentionItem,
  syncEditorDomEmpty,
  syncEditorValue,
  type MentionInputHandle,
} from './mention-input-editor'

export type { MentionInputFormatCommand } from './mention-input-dom'
export type { MentionInputHandle }

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

function useMentionSearch(mentionCategories: MentionCategory[]) {
  const [categories, setCategories] = useState<MentionCategory[]>([])
  const [mentionSearching, setMentionSearching] = useState(false)
  const searchRequestRef = useRef(0)
  const {
    availableTypes: defaultAvailableTypes,
    search: searchDefaultCategories,
    loading,
    fetchAllData,
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

  const runMentionSearch = useCallback((query: string) => {
    const requestId = ++searchRequestRef.current
    setCategories([])
    setMentionSearching(true)
    void search(query)
      .then((nextCategories) => {
        if (searchRequestRef.current === requestId) setCategories(nextCategories)
      })
      .finally(() => {
        if (searchRequestRef.current === requestId) setMentionSearching(false)
      })
  }, [search])

  return {
    availableTypes,
    categories,
    fetchAllData,
    loading,
    mentionSearching,
    runMentionSearch,
    search,
    searchRequestRef,
    setCategories,
    setMentionSearching,
  }
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
    const [selectedCategory, setSelectedCategory] = useState<MentionType | null>(null)
    const [activeOptionId, setActiveOptionId] = useState<string | null>(null)
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
      availableTypes,
      categories,
      fetchAllData,
      loading,
      mentionSearching,
      runMentionSearch,
      search,
      searchRequestRef,
      setCategories,
      setMentionSearching,
    } = useMentionSearch(mentionCategories)

    // Sync explicit external value commands into the editor (clear on send,
    // populate restored draft after hydration). Normal typing stays local to
    // the contenteditable so the chat surface does not re-render per key.
    useEffect(() => syncEditorValue({
      editorRef,
      lastValueRef,
      onMentionsChange,
      setIsEditorEmpty,
      value,
    }), [value, valueRevision, onMentionsChange])

    useImperativeHandle(ref, () => createMentionInputHandle({
      buttonInsertedAtRef,
      editorRef,
      lastValueRef,
      onChange,
      onMentionsChange,
      setIsEditorEmpty,
    }))

    const handleInput = useCallback(() => {
      handleEditorInput({
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
      })
    }, [onChange, onMentionsChange, runMentionSearch])

    const syncEditorEmptyState = useCallback(() => {
      syncEditorDomEmpty({ editorRef, setIsEditorEmpty })
    }, [])

    // Search when mentionQuery changes
    useEffect(() => {
      if (!showPopup) return
      void search(mentionQuery).then(setCategories)
    }, [mentionQuery, setCategories, showPopup, search])

    const handleSelect = useCallback(
      (item: MentionItem) => {
        selectMentionItem(item, {
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
        })
      },
      [onChange, onMentionsChange]
    )

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        handleEditorKeyDown(e, { editorRef, handleInput, onKeyDown, showPopup })
      },
      [showPopup, onKeyDown, handleInput]
    )

    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLDivElement>) => {
        handleEditorPaste(e, { editorRef, onPaste })
      },
      [onPaste]
    )

    const closePopup = useCallback(() => {
      closeMentionPopup({
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
      })
    }, [onChange, onMentionsChange, searchRequestRef, setMentionSearching])

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
          aria-label={typeof placeholder === 'string' ? placeholder : 'Message input'}
          onInput={handleInput}
          onFocus={() => {
            syncEditorEmptyState()
            void fetchAllData()
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => {
            isComposingRef.current = false
            handleInput()
          }}
          data-placeholder={placeholder}
          className={`relative w-full min-h-11 max-h-40 resize-none overflow-hidden overscroll-contain whitespace-pre-wrap break-words border-0 bg-transparent px-0.5 py-1 text-sm leading-6 text-[var(--foreground)] shadow-none outline-none ring-0 focus:ring-0 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--muted)] [&_code]:rounded [&_code]:bg-[var(--surface-subtle)] [&_code]:px-1 [&_code]:font-mono [&_h1]:my-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:my-1 [&_h2]:text-lg [&_h2]:font-semibold [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-0 [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-[var(--surface-subtle)] [&_pre]:px-3 [&_pre]:py-2 [&_pre]:font-mono [&_strong]:font-semibold [&_ul]:ml-5 [&_ul]:list-disc ${className || ''}`}
          role="combobox"
          aria-expanded={showPopup}
          aria-activedescendant={activeOptionId ?? undefined}
          aria-controls={showPopup ? 'mention-listbox' : undefined}
        />
        {showPopup && (
          <MentionPopup
            categories={categories}
            loading={mentionSearching || loading}
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
            onActiveOptionChange={setActiveOptionId}
          />
        )}
      </div>
    )
  }
)
