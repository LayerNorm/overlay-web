'use client'

// BlockNote editing surface for the canonical notebook editor. One editor per
// note (keyed remount upstream via deps on note id) — the doc is the authority
// and markdown is projected on every change.

import {
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from 'react'
import { BlockNoteView } from '@blocknote/shadcn'
import { useCreateBlockNote } from '@blocknote/react'
import type { PartialBlock } from '@blocknote/core'
import {
  getClientConverter,
  overlayNoteSchema,
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
  onReady,
  onHydrated,
}: {
  note: NotebookNote
  lifecycleController: MutableRefObject<NotebookEditorController | null>
  titleRef: MutableRefObject<string>
  mediaRef: MutableRefObject<NotebookEditorMediaAdapter | undefined>
  onReady: (handle: NotebookEditorHandle | null) => void
  onHydrated?: (note: NotebookNote) => void
}) {
  const dark = useIsDarkMode()

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
      schema: overlayNoteSchema(),
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

  return (
    <div className="bn-surface app-note-editor h-full">
      <BlockNoteView
        editor={editor}
        theme={dark ? 'dark' : 'light'}
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
      />
    </div>
  )
}
