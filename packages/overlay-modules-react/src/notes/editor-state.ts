'use client'

import { useState, useEffect, useCallback, useMemo, useRef, type MutableRefObject } from 'react'
import { useEditor } from '@tiptap/react'
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
import { common, createLowlight } from 'lowlight'
import { toast } from '@overlay/ui/primitives'
import {
  NOTEBOOK_INLINE_MATH_MIGRATION_REGEX,
  NotebookEditorController,
  createLocalNotebookNote,
  createNotebookAgentMentions,
  createNotebookDraftState,
  createRenamedNotebookNote,
  notebookAgentEventToUiItem,
  normalizeNotebookTitle,
  parseNotebookAgentStreamLine,
  upsertNotebookNote,
  type NotebookAgentRequest,
  type NotebookAgentUiItem,
  type NotebookEditorConflict,
  type NotebookNote,
  type NoteDoc,
} from '@overlay/app-core'
import { noteMarkdownToEditorHtml, toCanonicalNoteMarkdown } from '@overlay/app-core/note-markdown'
import {
  followNotebookAgentStream,
  notebookSnapshotMatches,
  stopNotebookRunAfterAcceptance,
} from './notebook-agent-reconnect'
import type { SlashMenuItem } from './slash-menu'
import { createSlashMenuItems } from './slash-menu-items'
import {
  InlineDiffExtension,
  INLINE_DIFF_CSS,
} from './inline-diff-extension'
import type {
  NotebookEditorMediaAdapter,
  NotebookEditorMention,
  NotebookEditorRepository,
} from './editor'

type TiptapEditor = ReturnType<typeof useEditor>
type FlushSaveRef = MutableRefObject<() => Promise<void> | void>

const lowlight = createLowlight(common)
const NOTEBOOK_INLINE_DIFF_STYLE_ID = 'notebook-inline-diff-styles'

function noteDocToNotebookNote(note: NoteDoc, now = Date.now()): NotebookNote {
  return {
    _id: note._id,
    title: note.title || 'Untitled',
    content: note.content ?? '',
    tags: note.tags ?? [],
    createdAt: note.createdAt ?? now,
    updatedAt: note.updatedAt ?? now,
  }
}

export function useEditorLifecycle({
  repository,
  liveNotes,
  onNoteChanged,
  media,
}: {
  repository: NotebookEditorRepository
  /** The host's live note list, for hosts that show the notes sidebar. */
  liveNotes?: readonly NoteDoc[]
  onNoteChanged?: (note: NotebookNote) => void
  media?: NotebookEditorMediaAdapter
}) {
  const [notes, setNotes] = useState<NotebookNote[]>(() => liveNotes?.map((note) => noteDocToNotebookNote(note)) ?? [])
  const [previousLiveNotes, setPreviousLiveNotes] = useState(liveNotes)
  if (previousLiveNotes !== liveNotes) {
    setPreviousLiveNotes(liveNotes)
    if (liveNotes) setNotes(liveNotes.map((note) => noteDocToNotebookNote(note)))
  }
  const [activeNote, setActiveNote] = useState<NotebookNote | null>(null)
  const [title, setTitle] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [editorConflict, setEditorConflict] = useState<NotebookEditorConflict | undefined>()
  const activeNoteRef = useRef<NotebookNote | null>(null)
  const titleRef = useRef('')
  const hydratingEditorRef = useRef(false)
  const flushSaveRef = useRef<() => Promise<void> | void>(() => {})
  const repositoryRef = useRef(repository)
  const onNoteChangedRef = useRef(onNoteChanged)
  const mediaRef = useRef(media)

  useEffect(() => {
    repositoryRef.current = repository
    onNoteChangedRef.current = onNoteChanged
    mediaRef.current = media
  }, [media, onNoteChanged, repository])

  const lifecycleControllerRef = useRef<NotebookEditorController | null>(null)
  useEffect(() => {
    lifecycleControllerRef.current ??= new NotebookEditorController({
      debounceMs: 800,
      async save(request) {
        // The editor tracks TipTap HTML; notes are stored as Markdown.
        const content = toCanonicalNoteMarkdown(request.content)
        const result = await repositoryRef.current.save({
          noteId: request.id,
          title: request.title,
          content,
          expectedUpdatedAt: request.baseRevision ? Number(request.baseRevision) : undefined,
        })
        if (result.conflict) {
          toast.error(result.conflict.message)
          return { conflict: result.conflict }
        }
        const persisted = result.note
          ? noteDocToNotebookNote(result.note)
          : {
              ...(activeNoteRef.current ?? createLocalNotebookNote(request.id)),
              title: normalizeNotebookTitle(request.title),
              content,
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
    })
  }, [])

  useEffect(() => lifecycleControllerRef.current?.subscribe((snapshot) => {
    setIsDirty(snapshot.dirty)
    setEditorConflict(snapshot.conflict)
  }), [])

  useEffect(() => {
    flushSaveRef.current = () => lifecycleControllerRef.current?.flush()
  }, [])

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
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (lifecycleControllerRef.current?.snapshot().dirty) {
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
    return () => { void lifecycleControllerRef.current?.flush() }
  }, [])

  return {
    notes,
    setNotes,
    activeNote,
    setActiveNote,
    title,
    setTitle,
    isDirty,
    editorConflict,
    lifecycleController: lifecycleControllerRef,
    activeNoteRef,
    titleRef,
    hydratingEditorRef,
    flushSaveRef,
    mediaRef,
  }
}

export function useSlashMenuState() {
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 })
  const [slashMenuFilter, setSlashMenuFilter] = useState('')
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)
  return {
    showSlashMenu,
    setShowSlashMenu,
    slashMenuPosition,
    setSlashMenuPosition,
    slashMenuFilter,
    setSlashMenuFilter,
    selectedSlashIndex,
    setSelectedSlashIndex,
  }
}

export function useNotebookEditor({
  lifecycleController,
  activeNoteRef,
  titleRef,
  hydratingEditorRef,
  mediaRef,
  slashState,
}: {
  lifecycleController: MutableRefObject<NotebookEditorController | null>
  activeNoteRef: MutableRefObject<NotebookNote | null>
  titleRef: MutableRefObject<string>
  hydratingEditorRef: MutableRefObject<boolean>
  mediaRef: MutableRefObject<NotebookEditorMediaAdapter | undefined>
  slashState: ReturnType<typeof useSlashMenuState>
}) {
  const { setSlashMenuPosition, setSlashMenuFilter, setShowSlashMenu } = slashState

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
        lifecycleController.current?.edit({
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
        class: 'typeset app-note-editor',
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

  return { editor }
}

export function useEditorRequests({
  editor,
  focusRequest,
  externalInsertion,
}: {
  editor: TiptapEditor | null
  focusRequest?: number
  externalInsertion?: { id: string; text: string }
}) {
  const lastInsertionRef = useRef<string | null>(null)

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
}

export function useSlashMenu({
  editor,
  slashState,
}: {
  editor: TiptapEditor | null
  slashState: ReturnType<typeof useSlashMenuState>
}) {
  const {
    showSlashMenu,
    setShowSlashMenu,
    slashMenuFilter,
    setSlashMenuFilter,
    selectedSlashIndex,
    setSelectedSlashIndex,
  } = slashState

  const slashMenuItems = useMemo<SlashMenuItem[]>(() => createSlashMenuItems(editor), [editor])

  const filteredSlashItems = useMemo(() => {
    if (!slashMenuFilter) return slashMenuItems
    const query = slashMenuFilter.toLowerCase()
    return slashMenuItems.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query),
    )
  }, [slashMenuFilter, slashMenuItems])

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
    [editor, setShowSlashMenu, setSlashMenuFilter],
  )

  useEffect(() => {
    setSelectedSlashIndex(0)
  }, [slashMenuFilter, showSlashMenu, setSelectedSlashIndex])

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
  }, [showSlashMenu, filteredSlashItems, selectedSlashIndex, executeSlashCommand, setSelectedSlashIndex, setShowSlashMenu, setSlashMenuFilter])

  return { slashMenuItems, filteredSlashItems, executeSlashCommand }
}

export function useNotebookNotes({
  noteId,
  liveNote,
  hideSidebar,
  repository,
  onNavigateNote,
  onHydrated,
  lifecycleController,
  activeNote,
  setNotes,
  setActiveNote,
  setTitle,
  hydratingEditorRef,
  editor,
}: {
  noteId: string | null
  /** The open note as the host's subscription sees it; null once it is deleted or unreadable. */
  liveNote?: NoteDoc | null
  hideSidebar?: boolean
  repository: NotebookEditorRepository
  onNavigateNote: (noteId: string) => void
  onHydrated?: (note: NotebookNote) => void
  lifecycleController: MutableRefObject<NotebookEditorController | null>
  activeNote: NotebookNote | null
  setNotes: React.Dispatch<React.SetStateAction<NotebookNote[]>>
  setActiveNote: (note: NotebookNote | null) => void
  setTitle: (title: string) => void
  hydratingEditorRef: MutableRefObject<boolean>
  editor: TiptapEditor | null
}) {
  const openNote = useCallback((note: NotebookNote) => {
    lifecycleController.current?.select({
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
  }, [hideSidebar, lifecycleController, onNavigateNote, setActiveNote, setTitle])

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
  }, [activeNote?._id, hideSidebar, idParam, openNote, repository, setNotes])

  useEffect(() => {
    if (!editor) return
    hydratingEditorRef.current = true
    if (!activeNote) {
      editor.commands.clearContent()
      hydratingEditorRef.current = false
      return
    }

    editor.commands.setContent(noteMarkdownToEditorHtml(toCanonicalNoteMarkdown(activeNote.content || '')))
    migrateMathStrings(editor, NOTEBOOK_INLINE_MATH_MIGRATION_REGEX)
    hydratingEditorRef.current = false
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent, react-doctor/no-pass-data-to-parent
    onHydrated?.(activeNote)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activeNote?._id])

  // A newer version saved elsewhere replaces a clean editor; a dirty one keeps its draft until its save conflicts.
  const liveRevision = liveNote && liveNote._id === activeNote?._id ? liveNote.updatedAt : undefined
  useEffect(() => {
    if (!editor || !liveNote || liveRevision === undefined) return
    const note = noteDocToNotebookNote(liveNote)
    const adopted = lifecycleController.current?.receiveRemote({
      id: note._id, title: note.title, content: note.content, revision: String(note.updatedAt), updatedAt: note.updatedAt,
    })
    if (!adopted) return
    hydratingEditorRef.current = true
    editor.commands.setContent(noteMarkdownToEditorHtml(toCanonicalNoteMarkdown(note.content)))
    migrateMathStrings(editor, NOTEBOOK_INLINE_MATH_MIGRATION_REGEX)
    hydratingEditorRef.current = false
    setActiveNote(note)
    setTitle(note.title)
  // Only a new server revision of the open note triggers this.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, liveRevision])

  return {
    openNote,
  }
}

export function useNoteMutations({
  repository,
  notes,
  setNotes,
  setActiveNote,
  setTitle,
  editor,
  lifecycleController,
  activeNoteRef,
  titleRef,
  flushSaveRef,
  onNoteChanged,
  onDeleteNote,
  onNavigateNote,
  openNote,
  createNoteRequest,
}: {
  repository: NotebookEditorRepository
  notes: NotebookNote[]
  setNotes: React.Dispatch<React.SetStateAction<NotebookNote[]>>
  setActiveNote: (note: NotebookNote | null) => void
  setTitle: (title: string) => void
  editor: TiptapEditor | null
  lifecycleController: MutableRefObject<NotebookEditorController | null>
  activeNoteRef: MutableRefObject<NotebookNote | null>
  titleRef: MutableRefObject<string>
  flushSaveRef: FlushSaveRef
  onNoteChanged?: (note: NotebookNote) => void
  onDeleteNote?: (noteId: string) => void
  onNavigateNote: (noteId: string) => void
  openNote: (note: NotebookNote) => void
  createNoteRequest?: number
}) {
  async function createNote(input?: { title?: string; content?: string }) {
    const created = await repository.create(input)
    const note = noteDocToNotebookNote(created)
    setNotes((prev) => upsertNotebookNote(prev, note))
    onNoteChanged?.(note)
    openNote(note)
  }

  const createNoteRef = useRef(createNote)
  const lastCreateNoteRequestRef = useRef(createNoteRequest)
  useEffect(() => {
    createNoteRef.current = createNote
  })
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
      lifecycleController.current?.clearSelection()
    }
  }, [activeNoteRef, lifecycleController, notes, onDeleteNote, onNavigateNote, repository, setActiveNote, setNotes, setTitle])
  const deleteSidebarNote = useCallback((noteId: string, event?: React.MouseEvent) => {
    void deleteNote(noteId, event)
  }, [deleteNote])

  function updateTitle(newTitle: string) {
    setTitle(newTitle)
    titleRef.current = newTitle
    if (activeNoteRef.current) {
      lifecycleController.current?.edit({
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

    lifecycleController.current?.edit({ title: nextTitle, content })
    await flushSaveRef.current()
  }

  function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' && event.key !== 'Tab') return
    event.preventDefault()
    void commitTitleChange().finally(() => {
      editor?.chain().focus('start').run()
    })
  }

  return {
    createNote,
    deleteNote,
    deleteSidebarNote,
    updateTitle,
    handleTitleChange,
    commitTitleChange,
    handleTitleKeyDown,
  }
}

async function readAgentStream(
  res: Response,
  editor: TiptapEditor | null,
  setAgentItems: React.Dispatch<React.SetStateAction<NotebookAgentUiItem[]>>,
  options: {
    eventIds: Set<string>
    proposalIds: Set<string>
    runIdentity: MutableRefObject<{ runId: string; conversationId: string; turnId: string; cursor?: string } | null>
    frozenMarkdown: string
    frozenTitle: string
    currentTitle: () => string
    currentMarkdown: () => string
    onAccepted: (identity: { runId: string; conversationId: string; turnId: string }) => Promise<void>
  },
): Promise<boolean> {
  const reader = res.body?.getReader()
  if (!reader) return false

  const decoder = new TextDecoder()
  let buffer = ''
  let terminal = false
  while (true) {
    let done: boolean
    let value: Uint8Array | undefined
    try {
      ({ done, value } = await reader.read())
    } catch {
      return false
    }
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const evt = parseNotebookAgentStreamLine(trimmed)
      if (!evt) continue

      if (evt.type === 'accepted') {
        const identity = { runId: evt.runId, conversationId: evt.conversationId, turnId: evt.turnId }
        const current = options.runIdentity.current
        if (current && (current.runId !== identity.runId || current.conversationId !== identity.conversationId
          || current.turnId !== identity.turnId)) {
          throw new Error('Notebook reconnect returned a different run identity.')
        }
        options.runIdentity.current = { ...identity, ...(evt.cursor ? { cursor: evt.cursor } : {}) }
        await options.onAccepted(identity)
        continue
      }
      if (evt.cursor && options.runIdentity.current) {
        options.runIdentity.current = { ...options.runIdentity.current, cursor: evt.cursor }
      }
      if (evt.type === 'done') terminal = true
      if (evt.eventId) {
        if (options.eventIds.has(evt.eventId)) continue
        options.eventIds.add(evt.eventId)
      }

      if (evt.type === 'edit_proposal') {
        const edit = evt.edit
        if (edit && !options.proposalIds.has(edit.id)) {
          options.proposalIds.add(edit.id)
          const changed = !notebookSnapshotMatches({
            frozenMarkdown: options.frozenMarkdown,
            currentMarkdown: options.currentMarkdown(),
            frozenTitle: options.frozenTitle,
            currentTitle: options.currentTitle(),
          })
          if (changed) {
            setAgentItems((prev) => [...prev, {
              type: 'error',
              text: 'The note changed after this run started. Rerun the request before applying its proposal.',
            }])
          } else {
            editor?.chain().focus().addDiffProposal(edit).run()
          }
        }
        continue
      }

      const item = notebookAgentEventToUiItem(evt)
      if (item) setAgentItems((prev) => [...prev, item])
    }
  }
  return terminal
}

export function useNotebookAgent({
  runAgent,
  stopAgent,
  editor,
  activeNote,
  title,
  titleRef,
  initialModelId,
  flushSaveRef,
  controlledAgentPanelOpen,
  onAgentPanelOpenChange,
}: {
  runAgent: (request: NotebookAgentRequest, signal: AbortSignal) => Promise<Response>
  stopAgent: (input: { conversationId: string; turnId: string }) => Promise<void>
  editor: TiptapEditor | null
  activeNote: NotebookNote | null
  title: string
  titleRef: MutableRefObject<string>
  initialModelId: string
  flushSaveRef: FlushSaveRef
  controlledAgentPanelOpen?: boolean
  onAgentPanelOpenChange?: (open: boolean) => void
}) {
  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [agentItems, setAgentItems] = useState<NotebookAgentUiItem[]>([])
  const [agentInput, setAgentInput] = useState('')
  const agentMentionsRef = useRef<NotebookEditorMention[]>([])
  const setAgentMentions = useCallback((next: NotebookEditorMention[]) => {
    agentMentionsRef.current = next
  }, [])
  const [agentRunning, setAgentRunning] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState(initialModelId)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const notebookAgentAbortRef = useRef<AbortController | null>(null)
  const notebookRunIdentityRef = useRef<{ runId: string; conversationId: string; turnId: string; cursor?: string } | null>(null)
  const stopRequestedRef = useRef(false)
  const notebookAgentMountedRef = useRef(false)
  const runInProgressRef = useRef(false)
  const stopAgentRef = useRef(stopAgent)
  const seenEventIdsRef = useRef(new Set<string>())
  const seenProposalIdsRef = useRef(new Set<string>())
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const activeNoteId = activeNote?._id
  stopAgentRef.current = stopAgent

  useEffect(() => {
    notebookAgentMountedRef.current = true
    return () => {
      notebookAgentMountedRef.current = false
      stopRequestedRef.current = true
      const controller = notebookAgentAbortRef.current
      const identity = notebookRunIdentityRef.current
      if (identity) {
        void stopAgentRef.current(identity)
          .catch(() => stopAgentRef.current(identity))
          .catch(() => undefined)
          .finally(() => controller?.abort())
      }
    }
  }, [activeNoteId])

  useEffect(() => {
    if (controlledAgentPanelOpen === undefined) return
    setAgentPanelOpen(controlledAgentPanelOpen)
  }, [controlledAgentPanelOpen])

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

  const handleToggleAgentPanel = useCallback(async () => {
    await flushSaveRef.current()
    setAgentPanelOpen((open) => {
      const next = !open
      onAgentPanelOpenChange?.(next)
      return next
    })
  }, [flushSaveRef, onAgentPanelOpenChange])

  const stopNotebookAgent = useCallback(() => {
    stopRequestedRef.current = true
    const identity = notebookRunIdentityRef.current
    const controller = notebookAgentAbortRef.current
    if (!identity) return
    void stopAgent(identity).then(() => {
      controller?.abort()
      notebookAgentAbortRef.current = null
      setAgentRunning(false)
    }).catch((error) => {
      setAgentItems((prev) => [...prev, {
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not stop the Notebook run.',
      }])
    })
  }, [stopAgent])

  const runNotebookAgent = useCallback(async () => {
    if (!editor || !activeNote || agentRunning || runInProgressRef.current) return
    const message = agentInput.trim()
    if (!message) return
    runInProgressRef.current = true
    stopRequestedRef.current = false
    try {
      await flushSaveRef.current()
    } catch (error) {
      runInProgressRef.current = false
      setAgentItems((prev) => [...prev, {
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not save the note before starting.',
      }])
      return
    }
    if (stopRequestedRef.current) {
      runInProgressRef.current = false
      return
    }
    const ac = new AbortController()
    notebookAgentAbortRef.current = ac
    notebookRunIdentityRef.current = null
    seenEventIdsRef.current = new Set()
    seenProposalIdsRef.current = new Set()
    setAgentRunning(true)

    try {
      const noteMarkdown = toCanonicalNoteMarkdown(editor.getHTML())
      const noteTitle = normalizeNotebookTitle(titleRef.current || title)
      const modelId = selectedModelId
      const turnId = globalThis.crypto?.randomUUID?.() ?? `notebook-${Date.now()}-${Math.random().toString(36).slice(2)}`

      setAgentItems((prev) => [...prev, { type: 'user', text: message }])
      const mentionsForRequest = createNotebookAgentMentions(agentMentionsRef.current)
      setAgentInput('')
      setAgentMentions([])

      const baseRequest: NotebookAgentRequest = {
        noteId: activeNote._id,
        turnId,
        noteContent: noteMarkdown,
        noteTitle,
        message,
        modelId,
        mentions: mentionsForRequest.length > 0 ? mentionsForRequest : undefined,
      }
      const result = await followNotebookAgentStream({
        request: baseRequest,
        runAgent,
        signal: ac.signal,
        getIdentity: () => notebookRunIdentityRef.current,
        readStream: (res) => readAgentStream(res, editor, setAgentItems, {
          eventIds: seenEventIdsRef.current,
          proposalIds: seenProposalIdsRef.current,
          runIdentity: notebookRunIdentityRef,
          frozenMarkdown: noteMarkdown,
          frozenTitle: noteTitle,
          currentTitle: () => titleRef.current,
          currentMarkdown: () => toCanonicalNoteMarkdown(editor.getHTML()),
          onAccepted: async (identityValue) => {
            try {
              await stopNotebookRunAfterAcceptance({
                identity: identityValue,
                requested: stopRequestedRef.current,
                stopAgent,
                disconnect: () => ac.abort(),
              })
            } catch (error) {
              if (!notebookAgentMountedRef.current) {
                void stopAgentRef.current(identityValue)
                  .catch(() => undefined)
                  .finally(() => ac.abort())
                return
              }
              setAgentItems((prev) => [...prev, {
                type: 'error',
                text: error instanceof Error ? error.message : 'Could not stop the Notebook run.',
              }])
            }
          },
        }),
      })
      if (result.status === 'exhausted') {
        setAgentItems((prev) => [...prev, {
          type: 'error',
          text: 'The Notebook stream disconnected repeatedly. Retry the request to continue.',
        }])
      } else if (result.status === 'request-error') {
        let errText = `Request failed (${result.response.status})`
        try {
          const j = (await result.response.json()) as { message?: string; error?: string }
          errText = j.message || j.error || errText
        } catch {
          try { errText = (await result.response.text()) || errText } catch { /* ignore */ }
        }
        setAgentItems((prev) => [...prev, { type: 'error', text: errText }])
      }
    } catch (e) {
      if (ac.signal.aborted || !notebookAgentMountedRef.current) return
      const msg = e instanceof Error ? e.message : String(e)
      setAgentItems((prev) => [...prev, { type: 'error', text: msg }])
    } finally {
      notebookAgentAbortRef.current = null
      notebookRunIdentityRef.current = null
      stopRequestedRef.current = false
      runInProgressRef.current = false
      if (notebookAgentMountedRef.current) setAgentRunning(false)
    }
  }, [activeNote, agentInput, agentRunning, editor, runAgent, stopAgent, selectedModelId, setAgentMentions, title, titleRef])

  return {
    agentPanelOpen,
    agentItems,
    agentInput,
    setAgentInput,
    setAgentMentions,
    agentRunning,
    selectedModelId,
    setSelectedModelId,
    showModelPicker,
    setShowModelPicker,
    modelPickerRef,
    handleToggleAgentPanel,
    stopNotebookAgent,
    runNotebookAgent,
  }
}
