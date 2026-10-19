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
})

test('block double-dollar math renders as display math', () => {
  assert.match(rendered('$$\nE = mc^2\n$$'), /katex-display/)
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
