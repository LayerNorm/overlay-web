import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createBaseMdComponents } from './renderers'

const md = createBaseMdComponents()

test('a fenced block renders the shared Code Block with its language and a copy button', () => {
  const html = renderToStaticMarkup(md.code({ className: 'language-python', children: 'a = 1\nb = 2\n' }))
  assert.match(html, /data-slot="code-block"/)
  assert.match(html, /data-slot="code-block-title"[^>]*>python</)
  assert.match(html, /aria-label="Copy"/)
  assert.equal(html.match(/data-slot="code-block-line"/g)?.length, 2)
})

test('html fences offer show code and render controls', () => {
  const html = renderToStaticMarkup(md.code({ className: 'language-html', children: '<p>Hi</p>' }))
  assert.match(html, /aria-label="Render HTML"/)
  assert.match(html, /aria-label="Show code"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Show code"/)
})

test('inline code stays a plain code element', () => {
  const html = renderToStaticMarkup(md.code({ children: 'x' }))
  assert.equal(html, '<code>x</code>')
})

test('a fenced block is not wrapped in an extra pre box', () => {
  const fenced = <md.code className="language-ts">const a = 1</md.code>
  const html = renderToStaticMarkup(md.pre({ children: fenced }))
  assert.ok(html.startsWith('<div data-slot="code-block"'), html.slice(0, 80))
  assert.equal(html.match(/<pre/g)?.length, 1)
})

test('spans keep inline styles so KaTeX superscripts stay raised', () => {
  const html = renderToStaticMarkup(md.span({ className: 'vlist', style: { top: '-3.06em' }, children: '2' }))
  assert.equal(html, '<span class="vlist" style="top:-3.06em">2</span>')
})
