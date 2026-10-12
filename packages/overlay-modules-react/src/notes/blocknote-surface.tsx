'use client'

// BlockNote editing surface for the canonical notebook editor. One editor per
// note (keyed remount upstream via deps on note id) — the doc is the authority
// and markdown is projected on every change.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { BlockNoteView } from '@blocknote/shadcn'
import {
  useCreateBlockNote,
  SuggestionMenuController,
} from '@blocknote/react'
import type { PartialBlock } from '@blocknote/core'
import {
  getClientConverter,
  parseNoteDocJson,
  stringifyNoteDoc,
} from '@overlay/note-doc'
import { noteMarkdownToEditorHtml } from '@overlay/app-core/note-markdown'
import { legacyHtmlToBlocksHtml } from '@overlay/note-doc'
import type {
  NotebookEditorController,
  NotebookNote,
} from '@overlay/app-core'
import {
  createBlockNoteHandle,
  type NotebookEditorHandle,
} from './editor-handle'
import type { NotebookEditorMediaAdapter } from './editor'
import { readNoteOutbox } from './notes-outbox'
import { noteSchema } from './bn-blocks'
import {
  getMentionMenuItems,
  getOverlaySlashMenuItems,
  type NoteMentionProvider,
} from './bn-menus'

function useIsDarkMode(): boolean {
  const [dark, setDark] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark'),
  )
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setDark(root.classList.contains('dark'))
    })
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

function noteToInitialBlocks(note: NotebookNote): PartialBlock[] | undefined {
  const stored = parseNoteDocJson(note.docJson)
  if (stored?.length) return stored

  const converter = getClientConverter()
  try {
    const html = legacyHtmlToBlocksHtml(
      noteMarkdownToEditorHtml(note.content || ''),
    )
    const blocks = converter.tryParseHTMLToBlocks(html) as PartialBlock[]
    return blocks.length ? blocks : undefined
  } catch {
    return undefined
  }
}

export function BlockNoteSurface({
  note,
  lifecycleController,
  titleRef,
  mediaRef,
  mentionProvider,
  onReady,
  onHydrated,
}: {
  note: NotebookNote
  lifecycleController: MutableRefObject<NotebookEditorController | null>
  titleRef: MutableRefObject<string>
  mediaRef: MutableRefObject<NotebookEditorMediaAdapter | undefined>
  mentionProvider?: NoteMentionProvider
  onReady: (handle: NotebookEditorHandle | null) => void
  onHydrated?: (note: NotebookNote) => void
}) {
  const dark = useIsDarkMode()
  const containerRef = useRef<HTMLDivElement>(null)

  // A matching outbox entry means a previous session had unsaved changes for
  // this exact server revision — restore that draft instead of stored content.
  const outbox = useMemo(() => {
    const entry = readNoteOutbox(note._id)
    return entry && entry.baseRevision === String(note.updatedAt) ? entry : null
  }, [note._id, note.updatedAt])

  const initialContent = useMemo(() => {
    const restored = outbox?.docJson ? parseNoteDocJson(outbox.docJson) : null
    if (restored?.length) return restored
    return noteToInitialBlocks(note)
  }, [note, outbox])

  const editor = useCreateBlockNote(
    {
      schema: noteSchema(),
      initialContent,
      uploadFile: async (file: File) => {
        const persisted = await mediaRef.current?.persistImage(file)
        if (!persisted) throw new Error('Upload unavailable')
        return persisted.src
      },
    },
    [note._id],
  )

  useEffect(() => {
    onReady(createBlockNoteHandle(editor as never))
    return () => onReady(null)
  }, [editor, onReady])

  // Restored outbox drafts re-enter the dirty lifecycle so they autosave again.
  useEffect(() => {
    if (outbox?.docJson) {
      lifecycleController.current?.edit({
        title: titleRef.current,
        content: outbox.content,
        docJson: outbox.docJson,
      })
    }
    onHydrated?.(note)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  const slashItems = useMemo(
    () => (query: string) =>
      Promise.resolve(
        getOverlaySlashMenuItems(editor as never).filter((item) => {
          const hay = [item.title, ...(item.aliases ?? [])]
            .join(' ')
            .toLowerCase()
          return query.trim() ? hay.includes(query.trim().toLowerCase()) : true
        }),
      ),
    [editor],
  )

  // Diff marks: when the stored doc changes outside this editor (an agent
  // write, another tab), reload the document and briefly mark the blocks that
  // arrived or changed. Local saves keep flowing through the lifecycle.
  const seenDocJsonRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (seenDocJsonRef.current === undefined) {
      seenDocJsonRef.current = note.docJson ?? null
      return
    }
    if (seenDocJsonRef.current === (note.docJson ?? null)) return
    seenDocJsonRef.current = note.docJson ?? null
    const incoming = parseNoteDocJson(note.docJson)
    if (!incoming) return

    const previousById = new Map(
      editor.document.map((block) => [block.id, JSON.stringify(block)]),
    )
    const changedIds: string[] = []
    for (const block of incoming as { id?: string }[]) {
      if (!block.id) continue
      const previous = previousById.get(block.id)
      if (previous === undefined || previous !== JSON.stringify(block)) {
        changedIds.push(block.id)
      }
    }
    if (!changedIds.length) return

    editor.replaceBlocks(
      editor.document.map((block) => block.id),
      incoming as never,
    )
    const root = containerRef.current
    for (const id of changedIds) {
      root
        ?.querySelector(`[data-id="${id}"]`)
        ?.classList.add('bn-diff-changed')
    }
    const timeout = setTimeout(() => {
      root
        ?.querySelectorAll('.bn-diff-changed')
        .forEach((element) => element.classList.remove('bn-diff-changed'))
    }, 6000)
    return () => clearTimeout(timeout)
  }, [note.docJson, editor])

  const mentionItems = useMemo(
    () => async (query: string) => {
      if (!mentionProvider) return []
      return getMentionMenuItems(mentionProvider, query, (item) => {
        editor.insertInlineContent([
          {
            type: 'mention',
            props: {
              mentionType: item.type,
              mentionId: item.id,
              label: item.name,
            },
          } as never,
          ' ',
        ])
      })
    },
    [mentionProvider, editor],
  )

  return (
    <div ref={containerRef} className="bn-surface app-note-editor h-full">
      <BlockNoteView
        editor={editor}
        theme={dark ? 'dark' : 'light'}
        slashMenu={false}
        onChange={() => {
          if (!lifecycleController.current) return
          const docJson = stringifyNoteDoc(
            editor.document as unknown as PartialBlock[],
          )
          const content = editor.blocksToMarkdownLossy(
            editor.document as never[],
          )
          lifecycleController.current.edit({
            title: titleRef.current,
            content,
            docJson,
          })
        }}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={slashItems}
          onItemClick={(item) => item.onItemClick?.()}
        />
        {mentionProvider ? (
          <SuggestionMenuController
            triggerCharacter="@"
            getItems={mentionItems}
            onItemClick={(item) => item.onItemClick?.()}
          />
        ) : null}
      </BlockNoteView>
    </div>
  )
}
