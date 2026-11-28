import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHROME_EXTENSION_ORIGIN,
  PAGE_TEXT_LIMIT,
  clipPageText,
  envelope,
  pageContextFile,
  parseAppRequest,
  parseExtensionReply,
} from './index.ts'

test('the extension origin matches the manifest key id', () => {
  assert.match(CHROME_EXTENSION_ORIGIN, /^chrome-extension:\/\/[a-p]{32}$/)
})

test('app requests round-trip and anything else is dropped', () => {
  assert.deepEqual(parseAppRequest(envelope({ type: 'page.context', id: 'a' })), { type: 'page.context', id: 'a' })
  assert.equal(parseAppRequest({ type: 'page.current', id: 'a' }), null)
  assert.equal(parseAppRequest({ channel: 'overlay-chrome', v: 2, type: 'page.current', id: 'a' }), null)
  assert.equal(parseAppRequest(envelope({ type: 'page.current', id: 'x'.repeat(65) })), null)
  assert.equal(parseAppRequest(envelope({ type: 'tabs.close', id: 'a' } as never)), null)
})

test('replies keep only http pages and well-formed context', () => {
  const page = { url: 'https://example.com/a', title: 'A' }
  assert.deepEqual(parseExtensionReply(envelope({ type: 'page.current', id: '1', page })), { type: 'page.current', id: '1', page })
  assert.deepEqual(
    parseExtensionReply(envelope({ type: 'page.current', id: '1', page: { url: 'chrome://settings', title: 'S' } })),
    { type: 'page.current', id: '1', page: null },
  )
  const context = { ...page, selection: '', text: 'Body', truncated: false }
  assert.deepEqual(parseExtensionReply(envelope({ type: 'page.context', id: '2', context })), { type: 'page.context', id: '2', context })
  assert.deepEqual(
    parseExtensionReply(envelope({ type: 'page.context', id: '2', context: { ...context, text: 'x'.repeat(PAGE_TEXT_LIMIT + 1) } })),
    { type: 'page.context', id: '2', context: null },
  )
})

test('page text is clipped to the limit', () => {
  assert.deepEqual(clipPageText('a\n\n\n\nb'), { text: 'a\n\nb', truncated: false })
  const long = clipPageText('x'.repeat(PAGE_TEXT_LIMIT + 10))
  assert.equal(long.text.length, PAGE_TEXT_LIMIT)
  assert.equal(long.truncated, true)
})

test('the attached file names the page and includes the selection first', () => {
  const file = pageContextFile({
    url: 'https://example.com/orders',
    title: 'Orders / November',
    selection: 'Late: #1042',
    text: 'All orders',
    truncated: true,
  })
  assert.equal(file.name, 'Orders November.md')
  assert.equal(
    file.content,
    '# Orders / November\n\nhttps://example.com/orders\n\n## Selected text\n\nLate: #1042\n\n## Page text\n\nAll orders\n\n_The page text was cut short._\n',
  )
  assert.equal(pageContextFile({ url: 'https://example.com/', title: '', selection: '', text: '', truncated: false }).name, 'example.com.md')
})
