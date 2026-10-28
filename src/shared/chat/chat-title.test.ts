import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isPlaceholderChatTitle,
  mergeChatTitle,
  resolveChatModifiedTitle,
} from './chat-title'

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
