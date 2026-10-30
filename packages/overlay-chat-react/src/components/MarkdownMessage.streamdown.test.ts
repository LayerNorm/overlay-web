import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownMessage } from './MarkdownMessage'

function rendered(text: string, isStreaming = false): string {
  return renderToStaticMarkup(React.createElement(MarkdownMessage, {
    text, isStreaming, suppressTypingIndicator: true,
  }))
}

test('inline single-dollar math renders with KaTeX', () => {
  assert.match(rendered('Area is $\\pi r^2$ here.'), /class="katex"/)
  // Superscripts are raised by KaTeX inline styles, which the span override must keep.
  assert.match(rendered('Area is $\\pi r^2$ here.'), /style="top:-/)
})

test('block double-dollar math renders as display math', () => {
  assert.match(rendered('$$\nE = mc^2\n$$'), /katex-display/)
})

test('clearance math stays inline without swallowing the explanatory sentence', () => {
  const html = rendered(String.raw`Protein binding cancels out. \(CL = f_u \times CL_{int}\), and \(C_{target,total} = C_{target,unbound}/f_u\). The product is independent of protein binding.`)
  assert.doesNotMatch(html, /katex-display|katex-error/)
  assert.match(html, /The product is independent of protein binding\./)
  assert.equal((html.match(/class="katex"/g) ?? []).length, 2)
})

test('a broken equation does not throw', () => {
  assert.doesNotThrow(() => rendered('Bad $\\frac{1}{$ math'))
})

test('fenced code renders the shared Code Block', () => {
  assert.match(rendered('```python\na = 1\n```'), /data-slot="code-block"/)
})

test('unfinished emphasis is styled while streaming', () => {
  assert.match(rendered('Some **bold text', true), /<strong>bold text<\/strong>/)
})

test('mentions update when the same text renders with a different mention list', () => {
  const text = '@Maya Chen can you take this?'
  renderToStaticMarkup(React.createElement(MarkdownMessage, { text, isStreaming: false, mentions: [{ type: 'person', id: 'p_other', name: 'Sam Lee' }] }))
  const html = renderToStaticMarkup(React.createElement(MarkdownMessage, { text, isStreaming: false, mentions: [{ type: 'person', id: 'p_maya', name: 'Maya Chen' }] }))
  assert.doesNotMatch(html, /@Maya Chen/)
  assert.match(html, /Maya Chen<\/span>/)
})

test('completed paragraphs, code, and math keep the streaming block structure', () => {
  const text = '# Answer\n\nA **formatted** response.\n\n```python\na = 1\n```\n\nArea is $\\pi r^2$.'
  const streaming = rendered(text, true)
  const completed = rendered(text, false)
  assert.equal(completed, streaming)
  assert.doesNotMatch(completed, /Response complete|Completed/)
})
