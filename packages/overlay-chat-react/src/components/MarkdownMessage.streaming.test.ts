import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {MarkdownMessage} from './MarkdownMessage'

function rendered(text: string, isStreaming: boolean): string {
  return renderToStaticMarkup(React.createElement(MarkdownMessage, {
    text, isStreaming, suppressTypingIndicator: true,
  }))
}
test('streaming identifiers and inline filenames retain the exact text seen after completion', () => {
  for (const text of ['UI_TRACE_FINAL_SAVE_CLAUDE_COMPLETE', 'report_draft.md', '`_private`', 'trailing_', '文件_版本', '\\_literal']) {
    assert.equal(rendered(text, true), rendered(text, false), text)
  }
})

test('streaming still styles actual incomplete emphasis without a visible synthetic delimiter', () => {
  const partial = rendered('_A useful finding', true)
  assert.match(partial, /<em>A useful finding<\/em>/)
  assert.equal(partial, rendered('_A useful finding_', false))
  assert.match(rendered('__A useful finding', true), /<strong>A useful finding<\/strong>/)
  assert.equal(rendered('_a_file name', true), rendered('_a_file name_', false))
})
