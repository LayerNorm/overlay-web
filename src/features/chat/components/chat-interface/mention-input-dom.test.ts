import assert from 'node:assert/strict'
import test from 'node:test'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { extractMarkdownFromElement } from './mention-input-dom'

// A minimal DOM: the serializer only reads node types, tag names, children and text.
type FakeNode = {
  nodeType: number
  tagName?: string
  textContent: string
  childNodes: FakeNode[]
  children: FakeNode[]
  dataset: Record<string, string>
  getAttribute: (name: string) => string | null
}

;(globalThis as { Node?: unknown }).Node ??= { ELEMENT_NODE: 1, TEXT_NODE: 3 }

function text(value: string): FakeNode {
  return { nodeType: 3, textContent: value, childNodes: [], children: [], dataset: {}, getAttribute: () => null }
}

function el(tagName: string, ...childNodes: FakeNode[]): FakeNode {
  return {
    nodeType: 1,
    tagName,
    childNodes,
    children: childNodes.filter((child) => child.nodeType === 1),
    get textContent() { return childNodes.map((child) => child.textContent).join('') },
    dataset: {},
    getAttribute: () => null,
  }
}

type MdNode = { type: string; children?: MdNode[] }

function listDepths(markdown: string): number[] {
  const depths: number[] = []
  const walk = (node: MdNode, depth: number) => {
    if (node.type === 'list') depths.push(depth)
    for (const child of node.children ?? []) walk(child, node.type === 'list' ? depth + 1 : depth)
  }
  walk(unified().use(remarkParse).parse(markdown) as MdNode, 0)
  return depths
}

test('sub-points under the tenth numbered point stay nested after sending', () => {
  const items = Array.from({ length: 9 }, (_, i) => el('LI', text(`point ${i + 1}`)))
  items.push(el('LI', text('tenth'), el('UL', el('LI', text('child')))))
  const markdown = extractMarkdownFromElement(el('DIV', el('OL', ...items)) as unknown as HTMLDivElement)

  assert.match(markdown, /\n10\. tenth\n {4}- child$/)
  assert.deepEqual(listDepths(markdown), [0, 1])
})

test('bullet and single-digit sub-points indent to their parent marker', () => {
  const markdown = extractMarkdownFromElement(el('DIV',
    el('UL', el('LI', text('a'), el('OL', el('LI', text('b'), el('UL', el('LI', text('c'))))))),
  ) as unknown as HTMLDivElement)

  assert.equal(markdown, '- a\n  1. b\n     - c')
  assert.deepEqual(listDepths(markdown), [0, 1, 2])
})
