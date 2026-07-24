import type { Editor } from '@tiptap/core'

/**
 * One "line" per top-level doc block, joined with newlines — matches InlineDiffExtension.getBlockRanges
 * and the notebook agent's read_note / propose_edit line indices.
 */
export function noteContentFromEditor(editor: Editor): string {
  const blocks: string[] = []
  editor.state.doc.forEach((node) => {
    blocks.push(node.textContent)
  })
  return blocks.join('\n')
}
