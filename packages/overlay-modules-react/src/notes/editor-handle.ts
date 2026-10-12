'use client'

// Engine-neutral handle the shared editor logic talks to. TipTap and BlockNote
// surfaces each build one; everything above them only sees this interface.

import type { Editor as TiptapEditor } from '@tiptap/react'
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core'
import {
  getClientConverter,
  markdownToNoteDocSync,
  stringifyNoteDoc,
} from '@overlay/note-doc'
import type { NotebookEdit } from '@overlay/app-core'

export interface NotebookEditorHandle {
  kind: 'tiptap' | 'blocknote'
  /** Canonical markdown of the current document (TipTap returns HTML). */
  getContent(): string
  /** One line of plain text per top-level block — what the agent sees. */
  getPlainTextLines(): string
  focusStart(): void
  focusEnd(): void
  insertParagraphAtEnd(text: string): void
  proposeAgentEdit(edit: NotebookEdit): void
}

export function createTiptapHandle(editor: TiptapEditor): NotebookEditorHandle {
  return {
    kind: 'tiptap',
    getContent: () => editor.getHTML(),
    getPlainTextLines: () => {
      const lines: string[] = []
      editor.state.doc.forEach((node) => {
        lines.push(node.textContent)
      })
      return lines.join('\n')
    },
    focusStart: () => editor.chain().focus('start').run(),
    focusEnd: () => editor.chain().focus('end').run(),
    insertParagraphAtEnd: (text) => {
      editor.chain().focus().insertContentAt(editor.state.doc.content.size, {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      }).run()
    },
    proposeAgentEdit: (edit) => {
      editor.chain().focus().addDiffProposal(edit).run()
    },
  }
}

function blockTextContent(block: PartialBlock): string {
  const content = Array.isArray(block.content)
    ? (block.content as { type?: string; text?: string }[])
    : []
  return content.map((item) => item.text ?? '').join('')
}

export function blocksToPlainLines(blocks: PartialBlock[]): string {
  const lines: string[] = []
  const walk = (items: PartialBlock[]) => {
    for (const block of items) {
      lines.push(blockTextContent(block))
      if (block.children?.length) walk(block.children as never[])
    }
  }
  walk(blocks)
  return lines.join('\n')
}

export function createBlockNoteHandle(
  editor: BlockNoteEditor,
): NotebookEditorHandle {
  const converter = getClientConverter()
  return {
    kind: 'blocknote',
    getContent: () =>
      converter.blocksToMarkdownLossy(
        editor.document as unknown as PartialBlock[],
      ) as string,
    getPlainTextLines: () =>
      blocksToPlainLines(editor.document as unknown as PartialBlock[]),
    focusStart: () => {
      const first = editor.document[0]
      if (first) editor.setTextCursorPosition(first.id, 'start')
      editor.focus()
    },
    focusEnd: () => {
      const last = editor.document[editor.document.length - 1]
      if (last) editor.setTextCursorPosition(last.id, 'end')
      editor.focus()
    },
    insertParagraphAtEnd: (text) => {
      const last = editor.document[editor.document.length - 1]
      editor.insertBlocks(
        [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] } as never],
        last,
        'after',
      )
      const next = editor.document[editor.document.length - 1]
      if (next) editor.setTextCursorPosition(next.id, 'end')
      editor.focus()
    },
    // Phase 1 applies the proposal directly: splice the agent's line range into
    // the plain-text doc, rebuild as markdown, replace all blocks. Phase 3
    // replaces this with block-aware diffs.
    proposeAgentEdit: (edit) => {
      const lines = blocksToPlainLines(
        editor.document as unknown as PartialBlock[],
      ).split('\n')
      const start = Math.max(0, Math.min(edit.startLine, lines.length))
      const end = Math.max(start, Math.min(edit.endLine, lines.length))
      const next = [
        ...lines.slice(0, start),
        ...edit.newLines,
        ...lines.slice(end),
      ]
      const { docJson } = markdownToNoteDocSync(converter, next.join('\n'))
      const parsed = JSON.parse(docJson) as { blocks?: PartialBlock[] }
      if (Array.isArray(parsed.blocks) && parsed.blocks.length) {
        editor.replaceBlocks(
          editor.document,
          parsed.blocks as never[],
        )
      }
    },
  }
}

export { stringifyNoteDoc }
