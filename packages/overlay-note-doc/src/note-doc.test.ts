import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { legacyHtmlToBlocksHtml } from './legacy'
import { parseNoteDocJson, stringifyNoteDoc } from './envelope'
import {
  disposeServerConverter,
  markdownToNoteDocServer,
  noteDocToMarkdownServer,
} from './server'

after(async () => {
  await disposeServerConverter()
})

// ServerBlockNoteEditor schedules jsdom/react work that can settle after the
// test runner finishes — swallow that specific cleanup race only.
process.on('uncaughtException', (error) => {
  if (/reading 'event'/.test(String(error))) return
  throw error
})

test('envelope round-trips and rejects malformed input', () => {
  const blocks = [{ type: 'paragraph' }]
  const docJson = stringifyNoteDoc(blocks as never)
  assert.equal(parseNoteDocJson(docJson)?.length, 1)
  assert.equal(parseNoteDocJson(undefined), null)
  assert.equal(parseNoteDocJson('not json'), null)
  assert.equal(parseNoteDocJson('{"v":1}'), null)
})

test('legacy transform maps mark, math, and youtube embed markup', () => {
  const html = [
    '<p><mark data-color="yellow" style="background-color: rgb(250,240,0)">hi</mark></p>',
    '<p><span data-type="inline-math" data-latex="x^2"></span></p>',
    '<div data-type="block-math" data-latex="a+b"></div>',
    '<div data-youtube-video=""><iframe src="https://www.youtube.com/embed/abc123"></iframe></div>',
  ].join('')
  const out = legacyHtmlToBlocksHtml(html)
  assert.match(out, /background-color: rgb\(250,240,0\)/)
  assert.match(out, /<math display="inline">.*x\^2/)
  assert.match(out, /<math display="block">.*a\+b/)
  assert.match(out, /<figure data-embed-url="https:\/\/www\.youtube\.com\/embed\/abc123"/)
})

test('markdown -> docJson -> markdown projection preserves structure', async () => {
  const source = [
    '# Title',
    '',
    '- first',
    '- second',
    '',
    '**bold** and *italic* and `code`',
    '',
    '| A | B |',
    '| - | - |',
    '| 1 | 2 |',
  ].join('\n')
  const { docJson, markdown } = await markdownToNoteDocServer(source)
  const blocks = parseNoteDocJson(docJson)
  assert.ok(blocks && blocks.length >= 4, 'expected parsed blocks')
  assert.equal(blocks[0]?.type, 'heading')
  assert.ok(blocks.some((b) => b.type === 'bulletListItem'))
  assert.ok(blocks.some((b) => b.type === 'table'))
  const projection = await noteDocToMarkdownServer(docJson)
  assert.match(projection, /Title/)
  assert.match(markdown, /Title/)
})

test('legacy GFM+math markdown converts to math blocks/inline content', async () => {
  const source = 'Para with inline math $x^2$ here.\n\n$$\n\\int_0^1 x\\,dx\n$$\n'
  const { docJson } = await markdownToNoteDocServer(source)
  const json = docJson
  assert.match(json, /"type":"math"/)
})

test('task list items keep checked state through conversion', async () => {
  const source = '- [x] done\n- [ ] todo\n'
  const { docJson } = await markdownToNoteDocServer(source)
  const blocks = parseNoteDocJson(docJson) ?? []
  const checks = blocks.filter((b) => b.type === 'checkListItem')
  assert.equal(checks.length, 2)
  assert.equal(
    (checks[0] as { props?: { checked?: boolean } }).props?.checked,
    true,
  )
})

test('underline HTML survives conversion as underline style', async () => {
  const source = 'text <u>underlined</u> tail'
  const { docJson } = await markdownToNoteDocServer(source)
  assert.match(docJson, /"underline":true/)
})

test('GFM alert blockquote becomes a callout block', async () => {
  const source = '> [!WARNING]\n> careful with this\n'
  const { docJson } = await markdownToNoteDocServer(source)
  const blocks = parseNoteDocJson(docJson) ?? []
  const callout = blocks.find((b) => b.type === 'callout')
  assert.ok(callout)
  assert.equal(
    (callout as { props?: { icon?: string } }).props?.icon,
    'warning',
  )
})

test('youtube embed markup becomes an embed block with normalized URL', async () => {
  const html = legacyHtmlToBlocksHtml(
    '<p><a href="https://youtu.be/dQw4w9WgXcQ">watch</a></p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
  )
  assert.match(html, /data-embed-url="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/)
})

test('embeddableUrl normalizes youtube watch/share and rejects others', async () => {
  const { embeddableUrl } = await import('./blocks')
  assert.equal(
    embeddableUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
  )
  assert.equal(
    embeddableUrl('https://youtu.be/dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
  )
  assert.equal(
    embeddableUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'),
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  )
  assert.equal(embeddableUrl('https://example.com/embed/x'), null)
  assert.equal(embeddableUrl('http://www.youtube.com/watch?v=x'), null)
})

test('mention anchor parses to mention inline content', async () => {
  const { markdownToNoteDocServer: toDoc } = await import('./server')
  const { docJson } = await toDoc(
    'see [Roadmap](overlay://file/mh7abc) for details',
  )
  assert.match(docJson, /"type":"mention"/)
  assert.match(docJson, /"mentionType":"file"/)
  assert.match(docJson, /"mentionId":"mh7abc"/)
})
