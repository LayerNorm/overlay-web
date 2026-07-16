'use client'

// Compatibility wrapper: notes are canonical kind=note files, with shared contracts/controllers
// in @overlay/app-core and reusable React presentation in @overlay/modules-react.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import NextImage from 'next/image'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Mathematics, { migrateMathStrings } from '@tiptap/extension-mathematics'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Typography from '@tiptap/extension-typography'
import Underline from '@tiptap/extension-underline'
import Youtube from '@tiptap/extension-youtube'
import Emoji from '@tiptap/extension-emoji'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BookImage,
  Check,
  ChevronDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  SmilePlus,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table2,
  TableCellsMerge,
  TableColumnsSplit,
  TableRowsSplit,
  Trash2,
  Underline as UnderlineIcon,
  Youtube as YoutubeIcon,
} from 'lucide-react'
import { common, createLowlight } from 'lowlight'
import SlashMenu, { type SlashMenuItem } from './SlashMenu'
import { ExportMenu } from '@/features/files/components/ExportMenu'
import { ShareDialog } from '@/features/share/components/ShareDialog'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  FILES_CHANGED_EVENT,
  NOTEBOOK_INLINE_MATH_MIGRATION_REGEX,
  NOTES_CHANGED_EVENT,
  createLocalNotebookNote,
  createNotebookAgentMentions,
  createNotebookDraftState,
  createRenamedNotebookNote,
  notebookAgentEventToUiItem,
  normalizeNotebookContent,
  normalizeNotebookTitle,
  parseNotebookAgentStreamLine,
  upsertNotebookNote,
  type NotebookAgentUiItem,
  type NotebookNote,
  type NoteDoc,
} from '@overlay/app-core'
import {
  NotebookAgentComposer,
  NotebookAgentHeader,
  NotebookAgentPanel,
  NotebookEmptyState,
  NotebookFloatingFormatToolbar,
  NotebookHeader,
} from '@overlay/modules-react/notes'
import { AppScreenBody, AppScreenShell } from '@overlay/modules-react/shell'
import {
  InlineDiffExtension,
  INLINE_DIFF_CSS,
  getPendingDiffs,
} from '@/features/notebook/components/InlineDiffExtension'
import { noteContentFromEditor } from '@/features/notebook/lib/notebook-editor-blocks'
import { readStoredActModelId, ACT_MODEL_KEY } from '@/shared/chat/chat-model-prefs'
import {
  getModelsByIntelligence,
  getChatModelDisplayName,
} from '@/shared/ai/gateway/model-data'
const MarkdownMessage = dynamic(() =>
  import('@/features/chat/components/MarkdownMessage').then((mod) => ({ default: mod.MarkdownMessage })),
)
import { MentionInput, type MentionInputHandle } from '@/features/chat/components/chat-interface/MentionInput'
import type { MentionItem } from '@/shared/knowledge/mention-types'

const lowlight = createLowlight(common)
const NOTEBOOK_INLINE_DIFF_STYLE_ID = 'notebook-inline-diff-styles'

function noteDocToNotebookNote(note: NoteDoc, now = Date.now()): NotebookNote {
  return {
    _id: note._id,
    title: note.title || 'Untitled',
    content: note.content ?? '',
    tags: note.tags ?? [],
    projectId: note.projectId,
    createdAt: note.createdAt ?? now,
    updatedAt: note.updatedAt ?? now,
  }
}

function promptForValue(message: string, defaultValue = ''): string | null {
  if (typeof window === 'undefined') return null
  const value = window.prompt(message, defaultValue)
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export default function NotebookEditor({
  userId: _userId,
  hideSidebar,
  projectName,
}: {
  userId: string
  hideSidebar?: boolean
  projectName?: string
}) {
  void _userId
  const router = useRouter()
  const searchParams = useSearchParams()
  const [notes, setNotes] = useState<NotebookNote[]>([])
  const [activeNote, setActiveNote] = useState<NotebookNote | null>(null)
  const [title, setTitle] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [showFloatingFormatToolbar, setShowFloatingFormatToolbar] = useState(false)
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 })
  const [slashMenuFilter, setSlashMenuFilter] = useState('')
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)
  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [agentItems, setAgentItems] = useState<NotebookAgentUiItem[]>([])
  const [agentInput, setAgentInput] = useState('')
  const [agentMentions, setAgentMentions] = useState<MentionItem[]>([])
  const agentInputRef = useRef<MentionInputHandle>(null)
  const [agentRunning, setAgentRunning] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState<string>(() => readStoredActModelId())
  const [showModelPicker, setShowModelPicker] = useState(false)
  const notebookAgentAbortRef = useRef<AbortController | null>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const activeNoteRef = useRef<NotebookNote | null>(null)
  const titleRef = useRef('')
  const isDirtyRef = useRef(false)
  const pendingNoteIdRef = useRef<string | null>(null)
  const pendingTitleRef = useRef('')
  const pendingContentRef = useRef('')
  const hydratingEditorRef = useRef(false)
  const flushSaveRef = useRef<() => Promise<void> | void>(() => {})

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (document.getElementById(NOTEBOOK_INLINE_DIFF_STYLE_ID)) return
    const el = document.createElement('style')
    el.id = NOTEBOOK_INLINE_DIFF_STYLE_ID
    el.textContent = INLINE_DIFF_CSS
    document.head.appendChild(el)
  }, [])

  useEffect(() => {
    titleRef.current = title
  }, [title])

  useEffect(() => {
    activeNoteRef.current = activeNote
  }, [activeNote])

  useEffect(() => {
    notebookAgentAbortRef.current?.abort()
    notebookAgentAbortRef.current = null
    setAgentRunning(false)
    setAgentItems([])
  }, [activeNote?._id])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        link: false,
        underline: false,
      }),
      Placeholder.configure({
        placeholder: 'Start writing... (type / for commands)',
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
        includeChildren: true,
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext',
      }),
      Mathematics.configure({
        katexOptions: { throwOnError: false },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Typography,
      Subscript,
      Superscript,
      Highlight.configure({
        multicolor: true,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ['http', 'https', 'mailto'],
      }),
      TextStyle,
      Youtube.configure({
        controls: true,
        nocookie: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Emoji.configure({
        enableEmoticons: true,
      }),
      InlineDiffExtension,
    ],
    content: '',
    immediatelyRender: false,
    onCreate: ({ editor: currentEditor }) => {
      migrateMathStrings(currentEditor, NOTEBOOK_INLINE_MATH_MIGRATION_REGEX)
    },
    onUpdate: ({ editor: currentEditor }) => {
      migrateMathStrings(currentEditor, NOTEBOOK_INLINE_MATH_MIGRATION_REGEX)

      if (hydratingEditorRef.current) return

      if (activeNoteRef.current) {
        isDirtyRef.current = true
        pendingNoteIdRef.current = activeNoteRef.current._id
        pendingTitleRef.current = titleRef.current
        pendingContentRef.current = currentEditor.getHTML()
        setIsDirty(true)
      }

      const { selection } = currentEditor.state
      const { $from } = selection
      const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)
      const slashQueryMatch = textBefore.match(/(?:^|\s)\/([^\s/]*)$/)

      if (slashQueryMatch) {
        const coords = currentEditor.view.coordsAtPos(selection.from)
        const nextLeft = Math.max(8, Math.min(coords.left, window.innerWidth - 296))
        const nextTop = Math.max(8, Math.min(coords.bottom + 8, window.innerHeight - 340))

        setSlashMenuPosition({ top: nextTop, left: nextLeft })
        setSlashMenuFilter(slashQueryMatch[1])
        setShowSlashMenu(true)
      } else {
        setShowSlashMenu(false)
        setSlashMenuFilter('')
      }
    },
    editorProps: {
      attributes: {
        class: 'app-note-editor',
      },
    },
  })

  const slashMenuItems = useMemo<SlashMenuItem[]>(
    () => [
      {
        title: 'Heading 1',
        description: 'Large section heading',
        icon: <Heading1 size={16} />,
        command: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
        category: 'nodes',
      },
      {
        title: 'Heading 2',
        description: 'Medium section heading',
        icon: <Heading2 size={16} />,
        command: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
        category: 'nodes',
      },
      {
        title: 'Heading 3',
        description: 'Small section heading',
        icon: <Heading3 size={16} />,
        command: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
        category: 'nodes',
      },
      {
        title: 'Bullet List',
        description: 'Create a simple bullet list',
        icon: <List size={16} />,
        command: () => editor?.chain().focus().toggleBulletList().run(),
        category: 'nodes',
      },
      {
        title: 'Numbered List',
        description: 'Create a numbered list',
        icon: <ListOrdered size={16} />,
        command: () => editor?.chain().focus().toggleOrderedList().run(),
        category: 'nodes',
      },
      {
        title: 'Task List',
        description: 'Create a task list with checkboxes',
        icon: <ListTodo size={16} />,
        command: () => editor?.chain().focus().toggleTaskList().run(),
        category: 'nodes',
      },
      {
        title: 'Blockquote',
        description: 'Pull text out as a quote',
        icon: <Quote size={16} />,
        command: () => editor?.chain().focus().toggleBlockquote().run(),
        category: 'nodes',
      },
      {
        title: 'Code Block',
        description: 'Add a code block with syntax highlighting',
        icon: <Code size={16} />,
        command: () => editor?.chain().focus().toggleCodeBlock().run(),
        category: 'nodes',
      },
      {
        title: 'Divider',
        description: 'Insert a horizontal rule',
        icon: <Minus size={16} />,
        command: () => editor?.chain().focus().setHorizontalRule().run(),
        category: 'nodes',
      },
      {
        title: 'Inline Equation',
        description: 'Insert inline math markup',
        icon: <Code size={16} />,
        command: () => editor?.chain().focus().insertContent('$E=mc^2$').run(),
        category: 'nodes',
      },
      {
        title: 'Table',
        description: 'Insert a 3x3 table',
        icon: <Table2 size={16} />,
        command: () =>
          editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        category: 'nodes',
      },
      {
        title: 'Image',
        description: 'Embed an image from a URL',
        icon: <BookImage size={16} />,
        command: () => {
          const src = promptForValue('Enter image URL:')
          if (src) editor?.chain().focus().setImage({ src }).run()
        },
        category: 'nodes',
      },
      {
        title: 'YouTube Video',
        description: 'Embed a YouTube video',
        icon: <YoutubeIcon size={16} />,
        command: () => {
          const src = promptForValue('Enter YouTube URL:')
          if (src) editor?.chain().focus().setYoutubeVideo({ src }).run()
        },
        category: 'nodes',
      },
      {
        title: 'Add Row Above',
        description: 'Add a row above the current row',
        icon: <TableRowsSplit size={16} />,
        command: () => editor?.chain().focus().addRowBefore().run(),
        category: 'table',
      },
      {
        title: 'Add Row Below',
        description: 'Add a row below the current row',
        icon: <TableRowsSplit size={16} />,
        command: () => editor?.chain().focus().addRowAfter().run(),
        category: 'table',
      },
      {
        title: 'Delete Row',
        description: 'Delete the current row',
        icon: <Trash2 size={16} />,
        command: () => editor?.chain().focus().deleteRow().run(),
        category: 'table',
      },
      {
        title: 'Add Column Before',
        description: 'Add a column before the current column',
        icon: <TableColumnsSplit size={16} />,
        command: () => editor?.chain().focus().addColumnBefore().run(),
        category: 'table',
      },
      {
        title: 'Add Column After',
        description: 'Add a column after the current column',
        icon: <TableColumnsSplit size={16} />,
        command: () => editor?.chain().focus().addColumnAfter().run(),
        category: 'table',
      },
      {
        title: 'Delete Column',
        description: 'Delete the current column',
        icon: <Trash2 size={16} />,
        command: () => editor?.chain().focus().deleteColumn().run(),
        category: 'table',
      },
      {
        title: 'Merge Cells',
        description: 'Merge the current selection',
        icon: <TableCellsMerge size={16} />,
        command: () => editor?.chain().focus().mergeCells().run(),
        category: 'table',
      },
      {
        title: 'Split Cell',
        description: 'Split the current cell',
        icon: <TableColumnsSplit size={16} />,
        command: () => editor?.chain().focus().splitCell().run(),
        category: 'table',
      },
      {
        title: 'Delete Table',
        description: 'Delete the entire table',
        icon: <TableRowsSplit size={16} />,
        command: () => editor?.chain().focus().deleteTable().run(),
        category: 'table',
      },
      {
        title: 'Bold',
        description: 'Make text bold',
        icon: <Bold size={16} />,
        command: () => editor?.chain().focus().toggleBold().run(),
        category: 'marks',
      },
      {
        title: 'Italic',
        description: 'Make text italic',
        icon: <Italic size={16} />,
        command: () => editor?.chain().focus().toggleItalic().run(),
        category: 'marks',
      },
      {
        title: 'Underline',
        description: 'Underline text',
        icon: <UnderlineIcon size={16} />,
        command: () => editor?.chain().focus().toggleUnderline().run(),
        category: 'marks',
      },
      {
        title: 'Strikethrough',
        description: 'Strike through text',
        icon: <Strikethrough size={16} />,
        command: () => editor?.chain().focus().toggleStrike().run(),
        category: 'marks',
      },
      {
        title: 'Inline Code',
        description: 'Inline code formatting',
        icon: <Code size={16} />,
        command: () => editor?.chain().focus().toggleCode().run(),
        category: 'marks',
      },
      {
        title: 'Highlight',
        description: 'Highlight text',
        icon: <Highlighter size={16} />,
        command: () => editor?.chain().focus().toggleHighlight().run(),
        category: 'marks',
      },
      {
        title: 'Align Left',
        description: 'Align text to the left',
        icon: <AlignLeft size={16} />,
        command: () => editor?.chain().focus().setTextAlign('left').run(),
        category: 'marks',
      },
      {
        title: 'Align Center',
        description: 'Center text',
        icon: <AlignCenter size={16} />,
        command: () => editor?.chain().focus().setTextAlign('center').run(),
        category: 'marks',
      },
      {
        title: 'Align Right',
        description: 'Align text to the right',
        icon: <AlignRight size={16} />,
        command: () => editor?.chain().focus().setTextAlign('right').run(),
        category: 'marks',
      },
      {
        title: 'Subscript',
        description: 'Make text subscript',
        icon: <SubscriptIcon size={16} />,
        command: () => editor?.chain().focus().toggleSubscript().run(),
        category: 'marks',
      },
      {
        title: 'Superscript',
        description: 'Make text superscript',
        icon: <SuperscriptIcon size={16} />,
        command: () => editor?.chain().focus().toggleSuperscript().run(),
        category: 'marks',
      },
      {
        title: 'Emoji',
        description: 'Insert an emoji',
        icon: <SmilePlus size={16} />,
        command: () => {
          const emoji = promptForValue('Enter an emoji:', '🙂')
          if (emoji) editor?.chain().focus().insertContent(emoji).run()
        },
        category: 'marks',
      },
    ],
    [editor],
  )

  const filteredSlashItems = useMemo(() => {
    if (!slashMenuFilter) return slashMenuItems
    const query = slashMenuFilter.toLowerCase()
    return slashMenuItems.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query),
    )
  }, [slashMenuFilter, slashMenuItems])

  const loadNotes = useCallback(async () => {
    if (hideSidebar) return
    try {
      const res = await overlayAppClient.notes.getResponse({ limit: 100 })
      if (res.ok) {
        const data = (await res.json()) as NoteDoc[]
        setNotes(Array.isArray(data) ? data.map(noteDocToNotebookNote) : [])
      }
    } catch {
      // ignore
    }
  }, [hideSidebar])

  const openNote = useCallback((note: NotebookNote) => {
    flushSaveRef.current()
    setIsDirty(false)
    setActiveNote(note)
    setTitle(note.title)
    if (!hideSidebar) {
      router.replace(`/app/notes?id=${encodeURIComponent(note._id)}`)
    }
  }, [hideSidebar, router])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden) flushSaveRef.current()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    return () => { flushSaveRef.current() }
  }, [])

  useEffect(() => {
    if (!showModelPicker) return
    function handleClickOutside(e: MouseEvent) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowModelPicker(false)
    }
    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showModelPicker])

  const idParam = searchParams?.get('id') ?? null
  useEffect(() => {
    if (!idParam) return
    const noteId = idParam
    if (activeNote?._id === noteId) return

    if (!hideSidebar && notes.length > 0) {
      const existing = notes.find((note) => note._id === noteId)
      if (existing && activeNote?._id !== noteId) {
        openNote(existing)
        return
      }
    }

    let cancelled = false
    async function loadNoteById() {
      try {
        const res = await overlayAppClient.notes.getResponse({ noteId })
        if (!res.ok) return
        const note = noteDocToNotebookNote((await res.json()) as NoteDoc)
        if (!cancelled) {
          if (hideSidebar) setNotes([note])
          openNote(note)
        }
      } catch {
        // ignore
      }
    }

    void loadNoteById()
    return () => {
      cancelled = true
    }
  }, [activeNote?._id, hideSidebar, idParam, notes, openNote])

  useEffect(() => {
    if (!editor) return
    hydratingEditorRef.current = true
    if (!activeNote) {
      editor.commands.clearContent()
      hydratingEditorRef.current = false
      return
    }

    editor.commands.setContent(normalizeNotebookContent(activeNote.content || ''))
    migrateMathStrings(editor, NOTEBOOK_INLINE_MATH_MIGRATION_REGEX)
    hydratingEditorRef.current = false
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activeNote?._id])

  useEffect(() => {
    setSelectedSlashIndex(0)
  }, [slashMenuFilter, showSlashMenu])

  const executeSlashCommand = useCallback(
    (item: SlashMenuItem) => {
      if (!editor) return

      const { selection } = editor.state
      const { $from } = selection
      const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)
      const slashIndex = textBefore.lastIndexOf('/')

      if (slashIndex !== -1) {
        const deleteFrom = $from.pos - (textBefore.length - slashIndex)
        editor.chain().focus().deleteRange({ from: deleteFrom, to: $from.pos }).run()
      }

      item.command()
      setShowSlashMenu(false)
      setSlashMenuFilter('')
    },
    [editor],
  )

  useEffect(() => {
    if (!showSlashMenu) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (filteredSlashItems.length === 0) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setShowSlashMenu(false)
          setSlashMenuFilter('')
        }
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedSlashIndex((prev) => (prev < filteredSlashItems.length - 1 ? prev + 1 : 0))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedSlashIndex((prev) => (prev > 0 ? prev - 1 : filteredSlashItems.length - 1))
      } else if (event.key === 'Enter') {
        if (!filteredSlashItems[selectedSlashIndex]) return
        event.preventDefault()
        executeSlashCommand(filteredSlashItems[selectedSlashIndex])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setShowSlashMenu(false)
        setSlashMenuFilter('')
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [showSlashMenu, filteredSlashItems, selectedSlashIndex, executeSlashCommand])

  async function flushSave() {
    if (!isDirtyRef.current || !pendingNoteIdRef.current) return
    isDirtyRef.current = false
    setIsDirty(false)
    const noteId = pendingNoteIdRef.current
    const noteTitle = pendingTitleRef.current
    const content = pendingContentRef.current
    try {
      const res = await overlayAppClient.notes.updateResponse({
        noteId,
        title: noteTitle,
        content,
      })
      if (!res.ok) {
        isDirtyRef.current = true
        setIsDirty(true)
        return
      }
      const data = (await res.json()) as { note?: NoteDoc | null }
      const note = data.note
        ? noteDocToNotebookNote(data.note)
        : {
            ...(activeNoteRef.current ?? createLocalNotebookNote(noteId)),
            title: normalizeNotebookTitle(noteTitle),
            content,
            updatedAt: Date.now(),
          }
      setNotes((prev) => upsertNotebookNote(prev, note))
      window.dispatchEvent(new CustomEvent(NOTES_CHANGED_EVENT, { detail: { note } }))
      window.dispatchEvent(new CustomEvent(FILES_CHANGED_EVENT))
    } catch {
      isDirtyRef.current = true
      setIsDirty(true)
    }
  }
  flushSaveRef.current = flushSave

  const handleBackToFiles = useCallback(async () => {
    await flushSaveRef.current()
    router.push('/app/files')
  }, [router])

  const handleToggleAgentPanel = useCallback(async () => {
    await flushSaveRef.current()
    setAgentPanelOpen((open) => !open)
  }, [])

  const stopNotebookAgent = useCallback(() => {
    notebookAgentAbortRef.current?.abort()
    notebookAgentAbortRef.current = null
    setAgentRunning(false)
  }, [])

  const runNotebookAgent = useCallback(async () => {
    if (!editor || !activeNote || agentRunning) return
    const message = agentInput.trim()
    if (!message) return
    const noteContent = noteContentFromEditor(editor)
    const modelId = selectedModelId

    setAgentItems((prev) => [...prev, { type: 'user', text: message }])
    const mentionsForRequest = createNotebookAgentMentions(agentMentions)
    setAgentInput('')
    setAgentMentions([])

    const ac = new AbortController()
    notebookAgentAbortRef.current = ac
    setAgentRunning(true)

    try {
      const res = await overlayAppClient.notes.notebookAgentResponse({
        noteContent,
        noteTitle: normalizeNotebookTitle(title),
        message,
        modelId,
        projectId: activeNote.projectId,
        mentions: mentionsForRequest.length > 0 ? mentionsForRequest : undefined,
      }, {
        credentials: 'same-origin',
        signal: ac.signal,
      })

      if (!res.ok) {
        let errText = `Request failed (${res.status})`
        try {
          const j = (await res.json()) as { message?: string; error?: string }
          errText = j.message || j.error || errText
        } catch {
          try {
            errText = (await res.text()) || errText
          } catch {
            /* ignore */
          }
        }
        setAgentItems((prev) => [...prev, { type: 'error', text: errText }])
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        setAgentItems((prev) => [...prev, { type: 'error', text: 'No response body' }])
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const evt = parseNotebookAgentStreamLine(trimmed)
          if (!evt) continue

          if (evt.type === 'edit_proposal') {
            const edit = evt.edit
            if (edit) editor.chain().focus().addDiffProposal(edit).run()
            continue
          }

          const item = notebookAgentEventToUiItem(evt)
          if (item) setAgentItems((prev) => [...prev, item])
        }
      }
    } catch (e) {
      if (ac.signal.aborted) return
      const msg = e instanceof Error ? e.message : String(e)
      setAgentItems((prev) => [...prev, { type: 'error', text: msg }])
    } finally {
      notebookAgentAbortRef.current = null
      setAgentRunning(false)
    }
  }, [activeNote, agentInput, agentMentions, agentRunning, editor, selectedModelId, title])

  async function createNote() {
    const res = await overlayAppClient.notes.createResponse({ title: 'Untitled', content: '' })
    if (res.ok) {
      const data = (await res.json()) as { id: string; note?: NoteDoc | null }
      if (data.note) {
        const note = noteDocToNotebookNote(data.note)
        setNotes((prev) => upsertNotebookNote(prev, note))
        window.dispatchEvent(new CustomEvent(NOTES_CHANGED_EVENT, { detail: { note } }))
        window.dispatchEvent(new CustomEvent(FILES_CHANGED_EVENT))
        openNote(note)
        return
      }
      const note = createLocalNotebookNote(data.id)
      setNotes((prev) => upsertNotebookNote(prev, note))
      window.dispatchEvent(new CustomEvent(NOTES_CHANGED_EVENT, { detail: { note } }))
      window.dispatchEvent(new CustomEvent(FILES_CHANGED_EVENT))
      openNote(note)
    }
  }

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const newTitle = event.target.value
    setTitle(newTitle)
    titleRef.current = newTitle
  }

  async function commitTitleChange() {
    const current = activeNoteRef.current
    if (!current) return
    const content = editor?.getHTML() || current.content || ''
    const draftState = createNotebookDraftState({
      note: current,
      draftTitle: titleRef.current,
      draftContent: content,
    })
    const nextTitle = draftState.title
    if (nextTitle !== titleRef.current) {
      setTitle(nextTitle)
      titleRef.current = nextTitle
    }
    if (nextTitle === current.title) return

    const note = createRenamedNotebookNote({ note: current, title: nextTitle, content })
    setActiveNote(note)
    activeNoteRef.current = note
    setNotes((prev) => upsertNotebookNote(prev, note))
    window.dispatchEvent(new CustomEvent(NOTES_CHANGED_EVENT, { detail: { note } }))

    isDirtyRef.current = true
    pendingNoteIdRef.current = note._id
    pendingTitleRef.current = nextTitle
    pendingContentRef.current = content
    setIsDirty(true)
    await flushSaveRef.current()
  }

  function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' && event.key !== 'Tab') return
    event.preventDefault()
    void commitTitleChange().finally(() => {
      editor?.chain().focus('start').run()
    })
  }

  const modelPicker = (
    <div ref={modelPickerRef} className="relative">
      <button
        type="button"
        onClick={() => !agentRunning && setShowModelPicker((v) => !v)}
        disabled={agentRunning}
        className={`flex h-8 min-h-8 items-center justify-between gap-2 rounded-md bg-[var(--surface-subtle)] px-2.5 py-0 text-left text-xs leading-none md:py-1 ${
          agentRunning ? 'cursor-not-allowed text-[var(--muted-light)]' : 'text-[var(--muted)] hover:bg-[var(--border)]'
        }`}
      >
        <span className="min-w-0 truncate">{getChatModelDisplayName(selectedModelId)}</span>
        <ChevronDown size={11} className="shrink-0" />
      </button>
      {showModelPicker && (
        <div className="overlay-pop-in absolute right-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg">
          <div className="max-h-72 overflow-y-auto">
            {getModelsByIntelligence(false).map((m) => {
              const isSel = m.id === selectedModelId
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedModelId(m.id)
                    try {
                      localStorage.setItem(ACT_MODEL_KEY, m.id)
                    } catch { /* ignore */ }
                    setShowModelPicker(false)
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-[var(--surface-muted)] ${
                    isSel ? 'text-[var(--foreground)] font-medium' : 'text-[var(--muted)]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {isSel ? <Check size={10} /> : <span className="w-[10px] inline-block" />}
                    {m.name}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )

  const assistantHeader = (
    <NotebookAgentHeader
      pendingDiffCount={editor ? getPendingDiffs(editor).length : 0}
      modelPicker={modelPicker}
      onAcceptAllDiffs={() => editor?.chain().focus().acceptAllDiffs().run()}
      onRejectAllDiffs={() => editor?.chain().focus().rejectAllDiffs().run()}
    />
  )

  const agentComposer = (
    <NotebookAgentComposer
      running={agentRunning}
      canSend={Boolean(agentInput.trim())}
      onSend={() => void runNotebookAgent()}
      onStop={stopNotebookAgent}
      input={
        <MentionInput
          ref={agentInputRef}
          value={agentInput}
          onChange={setAgentInput}
          onMentionsChange={setAgentMentions}
          onUploadFile={() => { /* note assistant: no file upload here */ }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (!agentRunning && agentInput.trim()) void runNotebookAgent()
            }
          }}
          placeholder="Ask about this note or describe edits, use @ to reference files, skills..."
          disabled={agentRunning}
        />
      }
    />
  )

  const overlayLogo = (
    <NextImage
      src="/assets/overlay-logo.png"
      alt=""
      width={14}
      height={14}
      className="mt-0.5 size-3.5 shrink-0 select-none"
      draggable={false}
    />
  )

  return (
    <AppScreenShell
      header={
        <NotebookHeader
          activeNote={activeNote}
          title={title}
          projectName={projectName}
          isDirty={isDirty}
          agentPanelOpen={agentPanelOpen}
          exportMenu={activeNote ? (
            <ExportMenu
              type="note"
              title={title || 'Untitled'}
              content={editor?.getHTML() || activeNote.content || ''}
              metadata={{
                createdAt: activeNote.createdAt,
                updatedAt: activeNote.updatedAt,
              }}
              renderShareDialog={(props) => <ShareDialog {...props} />}
            />
          ) : null}
          onBackToFiles={() => void handleBackToFiles()}
          onCreateNote={() => void createNote()}
          onTitleChange={handleTitleChange}
          onTitleBlur={() => void commitTitleChange()}
          onTitleKeyDown={handleTitleKeyDown}
          onToggleAgentPanel={() => void handleToggleAgentPanel()}
        />
      }
      rightPanel={agentPanelOpen && activeNote ? (
        <NotebookAgentPanel
          header={assistantHeader}
          items={agentItems}
          running={agentRunning}
          logo={overlayLogo}
          composer={agentComposer}
          renderMarkdownMessage={(text, isStreaming) => (
            <MarkdownMessage text={text} isStreaming={isStreaming} />
          )}
        />
      ) : null}
      rightPanelOpen={agentPanelOpen && Boolean(activeNote)}
      rightPanelWidth={400}
      onRightPanelClose={() => void handleToggleAgentPanel()}
    >
      <AppScreenBody padding="none" maxWidth="none" scroll="hidden" className="flex h-full flex-col">
        {activeNote ? (
          <>
            <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div className="h-full overflow-y-auto px-6 py-4">
                  <EditorContent editor={editor} />
                </div>

                <NotebookFloatingFormatToolbar
                  editor={editor}
                  open={showFloatingFormatToolbar}
                  onOpenChange={setShowFloatingFormatToolbar}
                />
              </div>
            </div>
            <SlashMenu
              showSlashMenu={showSlashMenu}
              slashMenuPosition={slashMenuPosition}
              slashMenuFilter={slashMenuFilter}
              selectedSlashIndex={selectedSlashIndex}
              setSelectedSlashIndex={setSelectedSlashIndex}
              filteredSlashItems={filteredSlashItems}
              executeSlashCommand={executeSlashCommand}
              onClose={() => {
                setShowSlashMenu(false)
                setSlashMenuFilter('')
              }}
            />
          </>
        ) : (
          <NotebookEmptyState onCreateNote={() => void createNote()} />
        )}
      </AppScreenBody>
    </AppScreenShell>
  )
}
