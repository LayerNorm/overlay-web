import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodeBlockCopyButton } from '@overlay/ui/ai'
import { createBaseMdComponents } from './renderers'
import { MERMAID_FALLBACK_NOTE, MermaidCodeBlockView } from './mermaid-block'
import { shortMermaidError } from './mermaid-render'

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

const FLOWCHART = 'flowchart LR\n  A[Sign up] --> B[Verify email]'

function findElement(node: unknown, type: unknown): { props: Record<string, unknown> } | null {
  if (!isValidElement(node)) {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findElement(child, type)
        if (found) return found
      }
    }
    return null
  }
  if (node.type === type) return node as { props: Record<string, unknown> }
  const props = node.props as { children?: unknown }
  if (typeof node.type === 'function' && node.type !== type && !('children' in props)) {
    return null
  }
  return findElement(props.children, type)
}

function mermaidView(overrides: Partial<Parameters<typeof MermaidCodeBlockView>[0]> = {}) {
  return MermaidCodeBlockView({
    source: FLOWCHART,
    incomplete: false,
    diagram: { status: 'pending' },
    view: 'diagram',
    onViewChange: () => {},
    ...overrides,
  })
}

test('mermaid fences default to the diagram view with a Diagram | Code toggle before copy', () => {
  const html = renderToStaticMarkup(md.code({ className: 'language-mermaid', children: `${FLOWCHART}\n` }))
  assert.match(html, /data-slot="code-block-title"[^>]*>mermaid</)
  assert.match(html, /role="group" aria-label="Block view"/)
  assert.match(html, /aria-pressed="true"[^>]*>Diagram</)
  assert.match(html, /aria-pressed="false"[^>]*>Code</)
  assert.ok(html.indexOf('>Code<') < html.indexOf('aria-label="Copy"'), 'toggle sits before copy')
})

test('a rendered mermaid diagram replaces the code until Code is chosen', () => {
  const diagram = { status: 'ready' as const, svg: '<svg viewBox="0 0 400 100"></svg>', width: 400 }
  const diagramHtml = renderToStaticMarkup(mermaidView({ diagram }))
  assert.match(diagramHtml, /data-slot="code-block-diagram"/)
  assert.match(diagramHtml, /max-width:400px;min-width:300px/)
  assert.doesNotMatch(diagramHtml, /data-slot="code-block-content"/)

  const codeHtml = renderToStaticMarkup(mermaidView({ diagram, view: 'code' }))
  assert.doesNotMatch(codeHtml, /data-slot="code-block-diagram"/)
  assert.equal(codeHtml.match(/data-slot="code-block-line"/g)?.length, 2)
  assert.match(codeHtml, /aria-pressed="true"[^>]*>Code</)
})

test('a mermaid render error falls back to code with a quiet note and no toggle', () => {
  const html = renderToStaticMarkup(mermaidView({ diagram: { status: 'error', error: 'Line 2: unexpected end of diagram' } }))
  assert.doesNotMatch(html, /aria-label="Block view"/)
  assert.doesNotMatch(html, /data-slot="code-block-diagram"/)
  assert.match(html, /data-slot="code-block-content"/)
  assert.match(html, /data-slot="code-block-footer"/)
  assert.ok(html.includes(MERMAID_FALLBACK_NOTE))
  assert.match(html, />Line 2: unexpected end of diagram</)
})

test('an incomplete streaming mermaid fence shows its code without a toggle or error', () => {
  const html = renderToStaticMarkup(mermaidView({ incomplete: true, diagram: { status: 'error', error: 'Line 2: x' } }))
  assert.doesNotMatch(html, /aria-label="Block view"/)
  assert.doesNotMatch(html, /data-slot="code-block-footer"/)
  assert.match(html, /data-slot="code-block-content"/)
})

test('copy always copies the mermaid source, in diagram and fallback views', () => {
  for (const diagram of [
    { status: 'ready' as const, svg: '<svg></svg>', width: null },
    { status: 'error' as const, error: 'Line 1: x' },
  ]) {
    const copy = findElement(mermaidView({ diagram }), CodeBlockCopyButton)
    assert.equal(copy?.props.value, FLOWCHART)
  }
})

test('mermaid parse errors shorten to one line', () => {
  const parseError = new Error("Parse error on line 2:\n...A --> B\n-------^\nExpecting 'SEMI', 'NEWLINE', got 'EOF'")
  assert.equal(shortMermaidError(parseError), 'Line 2: unexpected end of diagram')
  assert.equal(shortMermaidError(new Error("Parse error on line 3:\nx\nExpecting 'X', got 'PIPE'")), 'Line 3: unexpected PIPE')
  const openSubgraph = new Error("Parse error on line 4:\n...\nExpecting 'SEMI', got '1'")
  assert.equal(shortMermaidError(openSubgraph, 'flowchart TD\n  subgraph X\n  A --> B'), 'Line 4: subgraph is never closed')
  assert.equal(shortMermaidError(new Error('No diagram type detected matching given configuration for text: hello')), 'Unknown diagram type')
  assert.equal(shortMermaidError(undefined), 'Unknown diagram error')
})
