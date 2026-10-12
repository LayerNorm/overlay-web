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
import type { MarkdownToDocResult, NoteDocConverter } from './convert'

let serverEditorPromise: Promise<ServerBlockNoteEditor> | null = null

function getServerEditor(): Promise<ServerBlockNoteEditor> {
  serverEditorPromise ??= (async () => {
    const [{ ServerBlockNoteEditor }, { createOverlayNoteSchemaHeadless }] =
      await Promise.all([
        import('@blocknote/server-util'),
        import('./schema'),
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
    import('./convert'),
    getConverter(),
  ])
  return markdownToNoteDocAsync(converter, markdown)
}

/** Server equivalent of `noteDocToMarkdown` (async; runs under JSDOM). */
export async function noteDocToMarkdownServer(docJson: string): Promise<string> {
  const [{ noteDocToMarkdownAsync }, converter] = await Promise.all([
    import('./convert'),
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

/** A single block-level edit an agent can apply to a blocknote document. */
export interface NoteBlockEdit {
  op: 'replace' | 'delete' | 'insert_after' | 'insert_before'
  /** Existing block id to anchor on; required for every op. */
  blockId: string
  /** Markdown fragment producing the replacement/inserted blocks. */
  markdown?: string
}

export interface NoteBlockEditResult {
  docJson: string
  markdown: string
  applied: number
  skipped: string[]
}

/**
 * Applies block-level edits to a note's docJson, preserving every block the
 * edits did not touch — including custom blocks a markdown rewrite would
 * degrade. Returns the new docJson plus its markdown projection.
 */
export async function applyNoteBlockEditsServer(
  docJson: string,
  edits: NoteBlockEdit[],
): Promise<NoteBlockEditResult> {
  const [{ parseNoteDocJson, stringifyNoteDoc }, editor] = await Promise.all([
    import('./envelope'),
    getServerEditor(),
  ])
  const blocks = (parseNoteDocJson(docJson) ?? []) as PartialBlock[]
  const skipped: string[] = []
  let applied = 0

  for (const edit of edits) {
    const index = blocks.findIndex((block) => block.id === edit.blockId)
    if (index < 0) {
      skipped.push(edit.blockId)
      continue
    }
    let incoming: PartialBlock[] = []
    if (edit.op !== 'delete' && edit.markdown?.trim()) {
      incoming = (await editor.tryParseMarkdownToBlocks(
        edit.markdown,
      )) as PartialBlock[]
    }
    switch (edit.op) {
      case 'replace':
        if (!incoming.length) {
          skipped.push(edit.blockId)
          continue
        }
        blocks.splice(index, 1, ...incoming)
        break
      case 'delete':
        blocks.splice(index, 1)
        break
      case 'insert_after':
        if (!incoming.length) {
          skipped.push(edit.blockId)
          continue
        }
        blocks.splice(index + 1, 0, ...incoming)
        break
      case 'insert_before':
        if (!incoming.length) {
          skipped.push(edit.blockId)
          continue
        }
        blocks.splice(index, 0, ...incoming)
        break
      default:
        skipped.push(edit.blockId)
        continue
    }
    applied++
  }

  const nextDocJson = stringifyNoteDoc(blocks as never)
  const markdown = await editor.blocksToMarkdownLossy(blocks as never)
  return { docJson: nextDocJson, markdown, applied, skipped }
}
