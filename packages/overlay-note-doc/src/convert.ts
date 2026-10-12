import { BlockNoteEditor, type PartialBlock } from '@blocknote/core'
import { noteMarkdownToEditorHtml } from '@overlay/app-core/note-markdown'
import { overlayNoteSchema } from './schema'
import { legacyHtmlToBlocksHtml } from './legacy'
import { stringifyNoteDoc } from './envelope'

export interface NoteDocConverter {
  tryParseHTMLToBlocks(
    html: string,
  ): PartialBlock[] | Promise<PartialBlock[]>
  tryParseMarkdownToBlocks(
    markdown: string,
  ): PartialBlock[] | Promise<PartialBlock[]>
  blocksToMarkdownLossy(blocks: PartialBlock[]): string | Promise<string>
}

export interface MarkdownToDocResult {
  docJson: string
  /** Fresh markdown projection of the converted doc. */
  markdown: string
}

function markdownToBlocksHtml(markdown: string): string {
  return legacyHtmlToBlocksHtml(noteMarkdownToEditorHtml(markdown))
}

let clientEditor: NoteDocConverter | null = null

/**
 * Headless editor for DOM-available environments (browser). Lazily created and
 * reused — conversion carries no per-note state.
 */
export function getClientConverter(): NoteDocConverter {
  if (!clientEditor) {
    clientEditor = BlockNoteEditor.create({
      schema: overlayNoteSchema(),
    }) as unknown as NoteDocConverter
  }
  return clientEditor
}

/**
 * Canonical markdown -> { docJson, markdown projection } (sync converters only).
 *
 * The stored markdown is routed through the legacy TipTap HTML form first so
 * the inline HTML we persist (`<u>`, `<mark>`, math spans, embeds, alignment)
 * maps onto native BlockNote blocks/styles instead of raw HTML.
 */
export function markdownToNoteDocSync(
  converter: NoteDocConverter,
  markdown: string,
): MarkdownToDocResult {
  const blocks = converter.tryParseHTMLToBlocks(
    markdownToBlocksHtml(markdown),
  ) as PartialBlock[]
  return {
    docJson: stringifyNoteDoc(blocks),
    markdown: converter.blocksToMarkdownLossy(blocks) as string,
  }
}

/** Async variant for `ServerBlockNoteEditor` (Promise-returning methods). */
export async function markdownToNoteDocAsync(
  converter: NoteDocConverter,
  markdown: string,
): Promise<MarkdownToDocResult> {
  const blocks = await converter.tryParseHTMLToBlocks(
    markdownToBlocksHtml(markdown),
  )
  return {
    docJson: stringifyNoteDoc(blocks),
    markdown: await converter.blocksToMarkdownLossy(blocks),
  }
}

export function noteDocToMarkdownSync(
  converter: NoteDocConverter,
  docJson: string,
): string {
  const raw = JSON.parse(docJson) as { blocks?: PartialBlock[] }
  const blocks = Array.isArray(raw?.blocks) ? raw.blocks : []
  return converter.blocksToMarkdownLossy(blocks) as string
}

export async function noteDocToMarkdownAsync(
  converter: NoteDocConverter,
  docJson: string,
): Promise<string> {
  const raw = JSON.parse(docJson) as { blocks?: PartialBlock[] }
  const blocks = Array.isArray(raw?.blocks) ? raw.blocks : []
  return converter.blocksToMarkdownLossy(blocks)
}

/** Browser-only convenience over {@link markdownToNoteDocSync}. */
export function markdownToNoteDoc(markdown: string): MarkdownToDocResult {
  return markdownToNoteDocSync(getClientConverter(), markdown)
}

/** Browser-only convenience over {@link noteDocToMarkdownSync}. */
export function noteDocToMarkdown(docJson: string): string {
  return noteDocToMarkdownSync(getClientConverter(), docJson)
}
