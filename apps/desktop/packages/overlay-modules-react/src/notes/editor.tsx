'use client'

// Canonical notebook editor. Platform routing, persistence, and rich host UI
// are supplied through the adapter props declared below.

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
  type Ref,
} from 'react'
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
import { SlashMenu, type SlashMenuItem } from './slash-menu'
import {
  NOTEBOOK_INLINE_MATH_MIGRATION_REGEX,
  NotebookEditorController,
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
  type NotebookEditorConflict,
  type NotebookNote,
  type NoteDoc,
  type NotebookAgentRequest,
} from '@overlay/app-core'
import { NotebookAgentComposer, NotebookAgentPanel } from './agent-panel'
import { NotebookAgentHeader, NotebookHeader } from './header'
import {
  NotebookEmptyState,
  NotebookNotesSidebar,
  type NotebookNotesSidebarProps,
} from './sidebar'
import { NotebookFloatingFormatToolbar } from './format-toolbar'
import { AppScreenBody, AppScreenShell } from '../shell'
import {
  InlineDiffExtension,
  INLINE_DIFF_CSS,
  getPendingDiffs,
} from './inline-diff-extension'
import { noteContentFromEditor } from './editor-content'

export interface NotebookEditorMention {
  type: string
  id: string
  name: string
}

export interface NotebookEditorModel {
  id: string
  name: string
}

export interface NotebookEditorRepository {
  list(signal?: AbortSignal): Promise<NoteDoc[]>
  get(noteId: string, signal?: AbortSignal): Promise<NoteDoc | null>
  create(input?: { title?: string; content?: string }): Promise<NoteDoc>
  save(input: {
    noteId: string
    title: string
    content: string
    expectedUpdatedAt?: number
  }): Promise<{ note?: NoteDoc | null; conflict?: NotebookEditorConflict }>
  delete?(noteId: string): Promise<void>
}

export interface NotebookEditorMediaAdapter {
  persistImage(file: File): Promise<{ src: string; alt?: string }>
}

export interface NotebookAgentComposerRenderProps {
  value: string
  disabled: boolean
  running: boolean
  canSend: boolean
  placeholder: string
  models: readonly NotebookEditorModel[]
  selectedModelId: string
  onChange(value: string): void
  onMentionsChange(mentions: NotebookEditorMention[]): void
  onModelChange(modelId: string): void
  onKeyDown(event: React.KeyboardEvent): void
  onSend(): void
  onStop(): void
}

export interface NotebookEditorHeaderRenderProps {
  activeNote: NotebookNote | null
  loading: boolean
  title: string
  isDirty: boolean
  agentPanelOpen: boolean
  onCreateNote(): void
  onDeleteNote?(): void
  onTitleChange(value: string): void
  onTitleBlur(): void
  onTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void
  onToggleAgentPanel(): void
}

export interface CanonicalNotebookEditorProps {
  noteId: string | null
  hideSidebar?: boolean
  showNotesSidebar?: boolean
  hideBackButton?: boolean
  compactHeader?: boolean
  selectionPending?: boolean
  headerLeading?: ReactNode
  projectName?: string
  repository: NotebookEditorRepository
  runAgent(request: NotebookAgentRequest, signal: AbortSignal): Promise<Response>
  models: readonly NotebookEditorModel[]
  initialModelId: string
  onModelChange?(modelId: string): void
  onNavigateNote(noteId: string): void
  onBackToFiles(): void
  onNoteChanged?(note: NotebookNote): void
  renderExportMenu?(input: { note: NotebookNote; title: string; content: string }): ReactNode
  renderAgentInput?(input: {
    value: string
    disabled: boolean
    placeholder: string
    onChange(value: string): void
    onMentionsChange(mentions: NotebookEditorMention[]): void
    onKeyDown(event: React.KeyboardEvent<HTMLElement>): void
  }): ReactNode
  renderMarkdown?(text: string, streaming: boolean): ReactNode
  logo?: ReactNode
  media?: NotebookEditorMediaAdapter
  focusRequest?: number
  contentContainerRef?: Ref<HTMLDivElement>
  externalInsertion?: { id: string; text: string }
  controlledAgentPanelOpen?: boolean
  agentPanelMode?: 'docked' | 'floating'
  createNoteRequest?: number
  onHydrated?(note: NotebookNote): void
  onAgentPanelOpenChange?(open: boolean): void
  onDeleteNote?(noteId: string): void
  renderNotesSidebar?(props: NotebookNotesSidebarProps): ReactNode
  renderAgentComposer?(props: NotebookAgentComposerRenderProps): ReactNode
  renderHeader?(props: NotebookEditorHeaderRenderProps): ReactNode
}

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

export function CanonicalNotebookEditor({
  noteId,
  hideSidebar,
  showNotesSidebar,
  hideBackButton,
  compactHeader,
  selectionPending,
  headerLeading,
  projectName,
  repository,
  runAgent,
  models,
  initialModelId,
  onModelChange,
  onNavigateNote,
  onBackToFiles,
  onNoteChanged,
  renderExportMenu,
  renderAgentInput,
  renderMarkdown,
  logo,
  media,
  focusRequest,
  contentContainerRef,
  externalInsertion,
  controlledAgentPanelOpen,
  agentPanelMode = 'floating',
  createNoteRequest,
  onHydrated,
  onAgentPanelOpenChange,
  onDeleteNote,
  renderNotesSidebar,
  renderAgentComposer,
  renderHeader,
}: CanonicalNotebookEditorProps) {
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
  const [agentMentions, setAgentMentions] = useState<NotebookEditorMention[]>([])
  const [agentRunning, setAgentRunning] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState(initialModelId)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const notebookAgentAbortRef = useRef<AbortController | null>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const activeNoteRef = useRef<NotebookNote | null>(null)
  const titleRef = useRef('')
  const hydratingEditorRef = useRef(false)
  const flushSaveRef = useRef<() => Promise<void> | void>(() => {})
  const repositoryRef = useRef(repository)
  const onNoteChangedRef = useRef(onNoteChanged)
  const mediaRef = useRef(media)
  const lastInsertionRef = useRef<string | null>(null)
  const lastCreateNoteRequestRef = useRef(createNoteRequest)
  const [editorConflict, setEditorConflict] = useState<NotebookEditorConflict | undefined>()

  useEffect(() => {
    repositoryRef.current = repository
    onNoteChangedRef.current = onNoteChanged
    mediaRef.current = media
  }, [media, onNoteChanged, repository])

  const lifecycleController = useMemo(() => new NotebookEditorController({
    debounceMs: 800,
    async save(request) {
      const result = await repositoryRef.current.save({
        noteId: request.id,
        title: request.title,
        content: request.content,
        expectedUpdatedAt: request.baseRevision ? Number(request.baseRevision) : undefined,
      })
      if (result.conflict) return { conflict: result.conflict }
      const persisted = result.note
        ? noteDocToNotebookNote(result.note)
        : {
            ...(activeNoteRef.current ?? createLocalNotebookNote(request.id)),
            title: normalizeNotebookTitle(request.title),
            content: request.content,
            updatedAt: Date.now(),
          }
      setNotes((current) => upsertNotebookNote(current, persisted))
      onNoteChangedRef.current?.(persisted)
      return {
        document: {
          id: persisted._id,
          title: persisted.title,
          content: persisted.content,
          revision: String(persisted.updatedAt),
          updatedAt: persisted.updatedAt,
        },
      }
    },
  }), [])

  useEffect(() => lifecycleController.subscribe((snapshot) => {
    setIsDirty(snapshot.dirty)
    setEditorConflict(snapshot.conflict)
  }), [lifecycleController])

  flushSaveRef.current = () => lifecycleController.flush()

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

  useEffect(() => {
    if (controlledAgentPanelOpen === undefined) return
    setAgentPanelOpen(controlledAgentPanelOpen)
  }, [controlledAgentPanelOpen])

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
        lifecycleController.edit({
          title: titleRef.current,
          content: currentEditor.getHTML(),
        })
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
      handlePaste(view, event) {
        const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith('image/'))
        if (!file || !mediaRef.current) return false
        event.preventDefault()
        const position = view.state.selection.from
        void mediaRef.current.persistImage(file).then(({ src, alt }) => {
          if (!view.dom.isConnected) return
          const node = view.state.schema.nodes.image?.create({ src, alt: alt ?? file.name })
          if (node) view.dispatch(view.state.tr.insert(position, node))
        })
        return true
      },
      handleDrop(view, event, _slice, moved) {
        const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith('image/'))
        if (moved || !file || !mediaRef.current) return false
        event.preventDefault()
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        if (position === undefined) return true
        void mediaRef.current.persistImage(file).then(({ src, alt }) => {
          if (!view.dom.isConnected) return
          const node = view.state.schema.nodes.image?.create({ src, alt: alt ?? file.name })
          if (node) view.dispatch(view.state.tr.insert(position, node))
        })
        return true
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
      const data = await repository.list()
      setNotes(Array.isArray(data) ? data.map(noteDocToNotebookNote) : [])
    } catch {
      // ignore
    }
  }, [hideSidebar, repository])

  const openNote = useCallback((note: NotebookNote) => {
    lifecycleController.select({
      id: note._id,
      title: note.title,
      content: note.content,
      revision: String(note.updatedAt),
      updatedAt: note.updatedAt,
    })
    setActiveNote(note)
    setTitle(note.title)
    if (!hideSidebar) {
      onNavigateNote(note._id)
    }
  }, [hideSidebar, lifecycleController, onNavigateNote])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (lifecycleController.snapshot().dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [lifecycleController])

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden) flushSaveRef.current()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    return () => { void lifecycleController.flush() }
  }, [lifecycleController])

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

  const idParam = noteId
  useEffect(() => {
    if (!idParam) return
    const noteId = idParam
    if (activeNote?._id === noteId) return

    const controller = new AbortController()
    async function loadNoteById() {
      try {
        const loaded = await repository.get(noteId, controller.signal)
        if (!loaded || controller.signal.aborted) return
        const note = noteDocToNotebookNote(loaded)
        if (!controller.signal.aborted) {
          if (hideSidebar) setNotes([note])
          openNote(note)
        }
      } catch {
        // ignore
      }
    }

    void loadNoteById()
    return () => controller.abort()
  }, [activeNote?._id, hideSidebar, idParam, openNote, repository])

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
    onHydrated?.(activeNote)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activeNote?._id])

  useEffect(() => {
    if (!editor || focusRequest === undefined) return
    editor.commands.focus('end')
  }, [editor, focusRequest])

  useEffect(() => {
    if (!editor || !externalInsertion || lastInsertionRef.current === externalInsertion.id) return
    lastInsertionRef.current = externalInsertion.id
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, {
      type: 'paragraph',
      content: [{ type: 'text', text: externalInsertion.text }],
    }).run()
  }, [editor, externalInsertion])

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

  const handleBackToFiles = useCallback(async () => {
    await flushSaveRef.current()
    onBackToFiles()
  }, [onBackToFiles])

  const handleToggleAgentPanel = useCallback(async () => {
    await flushSaveRef.current()
    setAgentPanelOpen((open) => {
      const next = !open
      onAgentPanelOpenChange?.(next)
      return next
    })
  }, [onAgentPanelOpenChange])

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
      const res = await runAgent({
        noteContent,
        noteTitle: normalizeNotebookTitle(title),
        message,
        modelId,
        projectId: activeNote.projectId,
        mentions: mentionsForRequest.length > 0 ? mentionsForRequest : undefined,
      }, ac.signal)

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
  }, [activeNote, agentInput, agentMentions, agentRunning, editor, runAgent, selectedModelId, title])

  async function createNote(input?: { title?: string; content?: string }) {
    const created = await repository.create(input)
    const note = noteDocToNotebookNote(created)
    setNotes((prev) => upsertNotebookNote(prev, note))
    onNoteChanged?.(note)
    openNote(note)
  }

  const createNoteRef = useRef(createNote)
  createNoteRef.current = createNote
  useEffect(() => {
    if (createNoteRequest === undefined) return
    if (lastCreateNoteRequestRef.current === createNoteRequest) return
    lastCreateNoteRequestRef.current = createNoteRequest
    void createNoteRef.current()
  }, [createNoteRequest])

  const deleteNote = useCallback(async (noteId: string, event?: React.MouseEvent) => {
    event?.stopPropagation()
    if (!repository.delete) return
    await repository.delete(noteId)
    const remaining = notes.filter((note) => note._id !== noteId)
    setNotes(remaining)
    onDeleteNote?.(noteId)
    if (activeNoteRef.current?._id !== noteId) return
    const next = remaining[0]
    if (next) onNavigateNote(next._id)
    else {
      activeNoteRef.current = null
      setActiveNote(null)
      setTitle('')
      lifecycleController.clearSelection()
    }
  }, [lifecycleController, notes, onDeleteNote, onNavigateNote, repository])
  const deleteSidebarNote = useCallback((noteId: string, event?: React.MouseEvent) => {
    void deleteNote(noteId, event)
  }, [deleteNote])

  function updateTitle(newTitle: string) {
    setTitle(newTitle)
    titleRef.current = newTitle
    if (activeNoteRef.current) {
      lifecycleController.edit({
        title: newTitle,
        content: editor?.getHTML() || activeNoteRef.current.content || '',
      })
    }
  }

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    updateTitle(event.target.value)
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
    onNoteChanged?.(note)

    lifecycleController.edit({ title: nextTitle, content })
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
        <span className="min-w-0 truncate">{models.find((model) => model.id === selectedModelId)?.name ?? selectedModelId}</span>
        <ChevronDown size={11} className="shrink-0" />
      </button>
      {showModelPicker && (
        <div className="overlay-pop-in absolute right-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg">
          <div className="max-h-72 overflow-y-auto">
            {models.map((m) => {
              const isSel = m.id === selectedModelId
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedModelId(m.id)
                    onModelChange?.(m.id)
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
      onClose={() => void handleToggleAgentPanel()}
    />
  )

  const agentComposerProps: NotebookAgentComposerRenderProps = {
    value: agentInput,
    disabled: agentRunning,
    running: agentRunning,
    canSend: Boolean(agentInput.trim()),
    placeholder: 'Ask about this note or describe edits, use @ to reference files, skills...',
    models,
    selectedModelId,
    onChange: setAgentInput,
    onMentionsChange: setAgentMentions,
    onModelChange: (modelId) => {
      setSelectedModelId(modelId)
      onModelChange?.(modelId)
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (!agentRunning && agentInput.trim()) void runNotebookAgent()
      }
    },
    onSend: () => void runNotebookAgent(),
    onStop: stopNotebookAgent,
  }
  const agentComposer = renderAgentComposer?.(agentComposerProps) ?? (
    <NotebookAgentComposer
      running={agentRunning}
      canSend={Boolean(agentInput.trim())}
      onSend={() => void runNotebookAgent()}
      onStop={stopNotebookAgent}
      input={
        renderAgentInput?.({
          value: agentInput,
          onChange: setAgentInput,
          onMentionsChange: setAgentMentions,
          onKeyDown: (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (!agentRunning && agentInput.trim()) void runNotebookAgent()
            }
          },
          placeholder: 'Ask about this note or describe edits, use @ to reference files, skills...',
          disabled: agentRunning,
        }) ?? (
          <textarea
            value={agentInput}
            onChange={(event) => setAgentInput(event.target.value)}
            disabled={agentRunning}
            placeholder="Ask about this note or describe edits..."
            className="min-h-20 w-full resize-none bg-transparent text-sm outline-none"
          />
        )
      }
    />
  )

  const overlayLogo = logo ?? <span className="overlay-stream-marker h-3.5 w-3.5" aria-hidden />
  const resolvingRequestedNote = Boolean(selectionPending || (noteId && activeNote?._id !== noteId))
  const notebookHeaderProps: NotebookEditorHeaderRenderProps = {
    activeNote,
    loading: resolvingRequestedNote,
    title,
    isDirty,
    agentPanelOpen,
    onCreateNote: () => void createNote(),
    onDeleteNote: repository.delete && activeNote ? () => void deleteNote(activeNote._id) : undefined,
    onTitleChange: updateTitle,
    onTitleBlur: () => void commitTitleChange(),
    onTitleKeyDown: handleTitleKeyDown,
    onToggleAgentPanel: () => void handleToggleAgentPanel(),
  }

  return (
    <AppScreenShell
      header={renderHeader ? renderHeader(notebookHeaderProps) : (
        <NotebookHeader
          activeNote={activeNote}
          loading={resolvingRequestedNote}
          compact={compactHeader}
          title={title}
          projectName={projectName}
          isDirty={isDirty}
          agentPanelOpen={agentPanelOpen}
          leading={headerLeading}
          hideBackButton={hideBackButton}
          onDeleteNote={repository.delete && activeNote ? () => void deleteNote(activeNote._id) : undefined}
          exportMenu={activeNote ? renderExportMenu?.({
            note: activeNote,
            title: title || 'Untitled',
            content: editor?.getHTML() || activeNote.content || '',
          }) : null}
          onBackToFiles={() => void handleBackToFiles()}
          onCreateNote={() => void createNote()}
          onTitleChange={handleTitleChange}
          onTitleBlur={() => void commitTitleChange()}
          onTitleKeyDown={handleTitleKeyDown}
          onToggleAgentPanel={() => void handleToggleAgentPanel()}
        />
      )}
      rightPanel={agentPanelOpen && activeNote ? (
        <NotebookAgentPanel
          header={assistantHeader}
          items={agentItems}
          running={agentRunning}
          logo={overlayLogo}
          composer={agentComposer}
          renderMarkdownMessage={(text, isStreaming) => renderMarkdown?.(text, isStreaming) ?? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
          )}
        />
      ) : null}
      rightPanelOpen={agentPanelOpen && Boolean(activeNote)}
      rightPanelWidth={400}
      rightPanelMode={agentPanelMode}
      onRightPanelClose={() => void handleToggleAgentPanel()}
    >
      <AppScreenBody padding="none" maxWidth="none" scroll="hidden" className="relative flex h-full flex-row">
        {showNotesSidebar
          ? (renderNotesSidebar?.({
              notes,
              activeNoteId: activeNote?._id,
              onCreateNote: () => void createNote(),
              onOpenNote: (note) => onNavigateNote(note._id),
              onDeleteNote: deleteSidebarNote,
            }) ?? (
              <NotebookNotesSidebar
                notes={notes}
                activeNoteId={activeNote?._id}
                onCreateNote={() => void createNote()}
                onOpenNote={(note) => onNavigateNote(note._id)}
                onDeleteNote={deleteSidebarNote}
              />
            ))
          : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeNote ? (
            <>
            {editorConflict ? (
              <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs text-amber-800 dark:text-amber-200" role="alert">
                {editorConflict.message} Your local draft has been preserved.
              </div>
            ) : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div ref={contentContainerRef} className="h-full overflow-y-auto px-6 py-4">
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
          ) : resolvingRequestedNote ? (
            <div className="h-full w-full" aria-busy="true">
              <span className="sr-only">Loading note</span>
            </div>
          ) : (
            <NotebookEmptyState onCreateNote={() => void createNote()} />
          )}
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}
