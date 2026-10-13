import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editorHtmlToNoteMarkdown, noteMarkdownToEditorHtml } from '@overlay/app-core/note-markdown'
import { UpdateWorkSchema } from '@/shared/work/schema'
test('objective retains rich Markdown and checklist changes remain explicit', () => {
  const markdown = '## Outcome\n\n**Ship** a clear brief.\n\n- Review\n- Publish\n\n[Context](https://example.com/)'
  const saved = editorHtmlToNoteMarkdown(noteMarkdownToEditorHtml(markdown))
  assert.match(saved, /\*\*Ship\*\*/)
  assert.match(saved, /## Outcome/)
  assert.match(saved, /https:\/\/example.com/)
  assert.equal(UpdateWorkSchema.parse({ expectedUpdatedAt: 1, patch: { description: saved, doneWhen: [{ text: 'Reviewed', checked: true }] } }).patch.doneWhen?.[0].checked, true)
  assert.equal(UpdateWorkSchema.safeParse({ expectedUpdatedAt: 1, patch: { doneWhen: [{ text: '', checked: false }] } }).success, false)
})
