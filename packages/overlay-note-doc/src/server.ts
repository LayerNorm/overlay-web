/**
 * Server-side conversion via `ServerBlockNoteEditor` (JSDOM-backed).
 * Import from `@overlay/note-doc/server` — never in client bundles.
 */
import { ServerBlockNoteEditor } from '@blocknote/server-util'
import type { PartialBlock } from '@blocknote/core'
import { createOverlayNoteSchemaHeadless } from './schema.js'
import {
  markdownToNoteDocAsync,
  noteDocToMarkdownAsync,
  type MarkdownToDocResult,
  type NoteDocConverter,
} from './convert.js'

let serverEditor: ServerBlockNoteEditor | null = null

function getServerEditor(): ServerBlockNoteEditor {
  if (!serverEditor) {
    serverEditor = ServerBlockNoteEditor.create({
      schema: createOverlayNoteSchemaHeadless(),
    }) as unknown as ServerBlockNoteEditor
  }
  return serverEditor
}

function getConverter(): NoteDocConverter {
  const editor = getServerEditor()
  return {
    tryParseHTMLToBlocks: (html: string) =>
      editor.tryParseHTMLToBlocks(html) as Promise<PartialBlock[]>,
    tryParseMarkdownToBlocks: (markdown: string) =>
      editor.tryParseMarkdownToBlocks(markdown) as Promise<PartialBlock[]>,
    blocksToMarkdownLossy: (blocks: PartialBlock[]) =>
      editor.blocksToMarkdownLossy(blocks),
  }
}

/** Server equivalent of `markdownToNoteDoc` (async; runs under JSDOM). */
export async function markdownToNoteDocServer(
  markdown: string,
): Promise<MarkdownToDocResult> {
  return markdownToNoteDocAsync(getConverter(), markdown)
}

/** Server equivalent of `noteDocToMarkdown` (async; runs under JSDOM). */
export async function noteDocToMarkdownServer(docJson: string): Promise<string> {
  return noteDocToMarkdownAsync(getConverter(), docJson)
}

/** Tears down the shared server editor (tests/shutdown). */
export async function disposeServerConverter(): Promise<void> {
  const pending = serverEditor
  serverEditor = null
  pending?.editor?.unmount?.()
}
