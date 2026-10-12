/**
 * Server-side conversion via `ServerBlockNoteEditor` (JSDOM-backed).
 * Import from `@overlay/note-doc/server` — never in client bundles.
 *
 * `@blocknote/*` is loaded lazily through `import()`: its CJS bundle is
 * broken under plain `require()` (tiptap interop), and server call sites in
 * the app may be compiled to CJS (e.g. node --test via tsx). Dynamic import
 * always resolves the ESM build.
 */
import type { ServerBlockNoteEditor } from '@blocknote/server-util'
import type { PartialBlock } from '@blocknote/core'
import type { MarkdownToDocResult, NoteDocConverter } from './convert.js'

let serverEditorPromise: Promise<ServerBlockNoteEditor> | null = null

function getServerEditor(): Promise<ServerBlockNoteEditor> {
  serverEditorPromise ??= (async () => {
    const [{ ServerBlockNoteEditor }, { createOverlayNoteSchemaHeadless }] =
      await Promise.all([
        import('@blocknote/server-util'),
        import('./schema.js'),
      ])
    return ServerBlockNoteEditor.create({
      schema: createOverlayNoteSchemaHeadless(),
    }) as unknown as ServerBlockNoteEditor
  })()
  return serverEditorPromise
}

async function getConverter(): Promise<NoteDocConverter> {
  const editor = await getServerEditor()
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
  const [{ markdownToNoteDocAsync }, converter] = await Promise.all([
    import('./convert.js'),
    getConverter(),
  ])
  return markdownToNoteDocAsync(converter, markdown)
}

/** Server equivalent of `noteDocToMarkdown` (async; runs under JSDOM). */
export async function noteDocToMarkdownServer(docJson: string): Promise<string> {
  const [{ noteDocToMarkdownAsync }, converter] = await Promise.all([
    import('./convert.js'),
    getConverter(),
  ])
  return noteDocToMarkdownAsync(converter, docJson)
}

/** Tears down the shared server editor (tests/shutdown). */
export async function disposeServerConverter(): Promise<void> {
  const pending = serverEditorPromise
  serverEditorPromise = null
  const editor = await pending?.catch(() => null)
  editor?.editor?.unmount?.()
}
