import assert from 'node:assert/strict'
import test from 'node:test'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { MentionItem } from '@/shared/knowledge/mention-types'
import { composerLinkLabel, splitComposerChipSegments } from './composer-chips'
import {
  buildComposerChipNodes,
  createLinkChip,
  createMentionChip,
  extractMarkdownFromElement,
  LINK_CHIP_ATTR,
  MENTION_AVATAR_ATTR,
} from './mention-input-dom'

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

// Enough of `document` for the chip builders: elements keep attributes, data and children.
type FakeElement = FakeNode & {
  className: string
  attributes: Record<string, string>
  setAttribute: (name: string, value: string) => void
  hasAttribute: (name: string) => boolean
  append: (...nodes: FakeNode[]) => void
  replaceChildren: (...nodes: FakeNode[]) => void
  addEventListener: () => void
}

function fakeElement(tagName: string): FakeElement {
  const childNodes: FakeNode[] = []
  const attributes: Record<string, string> = {}
  let ownText: string | null = null
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    className: '',
    attributes,
    childNodes,
    get children() { return childNodes.filter((child) => child.nodeType === 1) },
    get textContent() { return ownText ?? childNodes.map((child) => child.textContent).join('') },
    set textContent(value: string) { ownText = value },
    dataset: {},
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => { attributes[name] = value },
    hasAttribute: (name) => name in attributes,
    append: (...nodes) => { childNodes.push(...nodes) },
    replaceChildren: (...nodes) => { childNodes.splice(0, childNodes.length, ...nodes) },
    addEventListener: () => {},
  }
}

;(globalThis as { document?: unknown }).document ??= {
  createElement: fakeElement,
  createElementNS: (_namespace: string, tagName: string) => fakeElement(tagName),
  createTextNode: text,
}

const SAM: MentionItem = { type: 'person', id: 'p_sam', name: 'Sam Okafor', principalType: 'human', photoUrl: 'https://photos.example/sam.png' }
const ATLAS: MentionItem = { type: 'person', id: 'p_atlas', name: 'Atlas', principalType: 'agent', avatarColor: '#2563eb', avatarShape: 'circle' }
const PRICING: MentionItem = { type: 'file', id: 'file_pricing', name: 'Pricing benchmark' }

function serialise(...nodes: unknown[]): string {
  return extractMarkdownFromElement(el('DIV', ...(nodes as FakeNode[])) as unknown as HTMLDivElement)
}

test('mention chips show the name without an @ and still send @name', () => {
  for (const item of [SAM, ATLAS, PRICING]) {
    const chip = createMentionChip(item) as unknown as FakeElement
    assert.equal(chip.textContent, item.name)
    assert.equal(serialise(chip), `@${item.name}`)
  }
  assert.equal(serialise(text('Ask '), createMentionChip(ATLAS), text(' and '), createMentionChip(SAM), text(' today')), 'Ask @Atlas and @Sam Okafor today')
})

test('person chips lead with the photo or initial and agent chips with a creature slot', () => {
  const lead = (item: MentionItem) => (createMentionChip(item) as unknown as FakeElement).childNodes[0] as FakeElement
  const photo = lead(SAM).childNodes[0] as FakeElement & { src?: string }
  assert.equal(photo.tagName, 'IMG')
  assert.equal(photo.src, SAM.photoUrl)
  const initial = lead({ ...SAM, photoUrl: undefined })
  assert.equal(initial.dataset.initial, 'S')
  assert.equal(initial.textContent, '')
  assert.equal(lead(ATLAS).getAttribute(MENTION_AVATAR_ATTR), 'agent')
  assert.equal(lead(PRICING).tagName, 'SVG')
})

test('a link chip shows a short label and sends the raw address', () => {
  const href = 'https://www.github.com/LayerNorm/overlay/pull/548?diff=split#files'
  const chip = createLinkChip(href) as unknown as FakeElement
  assert.equal(chip.getAttribute(LINK_CHIP_ATTR), href)
  assert.equal(chip.textContent, 'github.com/LayerNorm/overlay/…')
  assert.equal(composerLinkLabel('https://example.com/'), 'example.com')
  assert.equal(serialise(text('see '), chip, text(' now')), `see ${href} now`)
})

test('addresses and known mentions in plain text are split into chips', () => {
  assert.deepEqual(splitComposerChipSegments('Read https://example.com/a_b, then (https://skip.example) email a@Atlas.com @Atlasx @Atlas.', [ATLAS]), [
    { kind: 'text', text: 'Read ' },
    { kind: 'link', href: 'https://example.com/a_b' },
    { kind: 'text', text: ', then (https://skip.example) email a@Atlas.com @Atlasx ' },
    { kind: 'mention', item: ATLAS },
    { kind: 'text', text: '.' },
  ])
  assert.deepEqual(splitComposerChipSegments('plain @Nobody text', [ATLAS]), [{ kind: 'text', text: 'plain @Nobody text' }])
  const twin = { ...SAM, id: 'p_sam_2' }
  assert.deepEqual(splitComposerChipSegments('@Sam Okafor', [SAM, twin]), [{ kind: 'text', text: '@Sam Okafor' }])
})

test('a restored plain-text draft is rebuilt as chips that send the same text', () => {
  const draft = '@Atlas can you check https://github.com/LayerNorm/overlay/pull/548 with @Sam Okafor before launch?'
  const nodes = buildComposerChipNodes(draft, [SAM, ATLAS]) as unknown as FakeElement[]
  assert.deepEqual(nodes.map((node) => (node.nodeType === 3 ? 'text' : node.getAttribute(LINK_CHIP_ATTR) ? 'link' : 'mention')), [
    'mention', 'text', 'link', 'text', 'mention', 'text',
  ])
  assert.deepEqual(JSON.parse(nodes[0]!.dataset.mentionData!), ATLAS)
  assert.equal(serialise(...nodes), draft)
  assert.equal(buildComposerChipNodes('nothing to rebuild', [SAM, ATLAS]), null)
})
