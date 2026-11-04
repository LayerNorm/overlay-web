import assert from 'node:assert/strict'
import test from 'node:test'
import {splitUserDisplayText, getUserMessageDocNames, getMessageText} from './messages'

test('indexed document markers preserve body text, names, empty markers and malformed input', () => {
  assert.deepEqual(splitUserDisplayText('Hello\n\n\n[Indexed documents: a.md, b.txt, , c.csv]\n\n\nEnd [Indexed documents:d.md]'),
    {bodyText: 'Hello\n\nEnd', docNames: ['a.md', 'b.txt', 'c.csv', 'd.md']})
  assert.deepEqual(splitUserDisplayText('Keep [Indexed documents:] and [Indexed documents:   ] tail'),
    {bodyText: 'Keep [Indexed documents:] and  tail', docNames: []})
  const malformed = '[Indexed documents:'.repeat(20000) + '\t'.repeat(20000)
  assert.deepEqual(splitUserDisplayText(malformed), {bodyText: malformed.trim(), docNames: []})
  assert.deepEqual(splitUserDisplayText('Before[Indexed documents:' + '\t'.repeat(200000) + ']After'),
    {bodyText: 'BeforeAfter', docNames: []})
})


test('reloaded structured text retains document chips from persisted content', () => {
  const message = { content: 'Please read this.\n\n[Indexed documents: evidence.txt]',
    parts: [{ type: 'text', text: 'Please read this.' }] }
  assert.equal(getMessageText(message), 'Please read this.')
  assert.deepEqual(getUserMessageDocNames(message), ['evidence.txt'])
  assert.deepEqual(getUserMessageDocNames({ ...message, metadata: {
    indexedAttachments: [{ name: 'renamed.txt', fileIds: ['file-1'] }],
  } }), ['renamed.txt'])
})
