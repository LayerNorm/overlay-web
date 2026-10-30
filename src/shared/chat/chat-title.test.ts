import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isPlaceholderChatTitle,
  mergeChatTitle,
  resolveChatModifiedTitle,
  fallbackChatTitle,
} from './chat-title'

test('fallback titles use a short, clean excerpt of the first message', () => {
  assert.equal(fallbackChatTitle('  **Plan** a\nweekend in Kyoto. '), 'Plan a weekend in Kyoto')
  assert.equal(fallbackChatTitle('one two three four five six seven eight nine'), 'one two three four five six seven eight')
  assert.ok(fallbackChatTitle('x'.repeat(100)).length <= 60)
  assert.equal(fallbackChatTitle('  '), 'New Chat')
})

test('recognizes empty and placeholder chat titles', () => {
  for (const title of ['', '  ', 'New Chat', ' New thread ']) {
    assert.equal(isPlaceholderChatTitle(title), true)
  }
  assert.equal(isPlaceholderChatTitle('Quarterly planning'), false)
})

test('does not replace a generated title with a placeholder', () => {
  assert.equal(mergeChatTitle('Quarterly planning', 'New Chat'), 'Quarterly planning')
  assert.equal(mergeChatTitle('Quarterly planning', ''), 'Quarterly planning')
  assert.equal(mergeChatTitle('New Chat', 'Quarterly planning'), 'Quarterly planning')
})

test('resolves chat modifications from explicit, pending, and latest list titles', () => {
  assert.equal(resolveChatModifiedTitle({
    explicitTitle: 'Chosen title',
    pendingTitle: 'Generated title',
    latestListTitle: 'List title',
  }), 'Chosen title')
  assert.equal(resolveChatModifiedTitle({
    explicitTitle: 'New Chat',
    pendingTitle: 'Generated title',
    latestListTitle: 'List title',
  }), 'Generated title')
  assert.equal(resolveChatModifiedTitle({
    explicitTitle: 'New thread',
    latestListTitle: 'List title',
  }), 'List title')
})
