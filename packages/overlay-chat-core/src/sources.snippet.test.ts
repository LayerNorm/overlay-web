import assert from 'node:assert/strict'
import test from 'node:test'
import { plainTextSnippet } from './sources'

test('HTML tags are dropped from a source subtitle', () => {
  assert.equal(
    plainTextSnippet('<p><strong>Overlay-first computing</strong> moves more of that execution</p>'),
    'Overlay-first computing moves more of that execution',
  )
})

test('a fragment cut mid-tag loses the dangling halves and its bullet marker', () => {
  assert.equal(
    plainTextSnippet('><p>- <strong>Overlay-first computing</strong> moves to the layer <stro'),
    'Overlay-first computing moves to the layer',
  )
})

test('entities become their characters', () => {
  assert.equal(plainTextSnippet('Tom &amp; Jerry &lt;3&nbsp;&gt;'), 'Tom & Jerry <3 >')
})

test('markdown syntax is stripped but the words survive', () => {
  assert.equal(plainTextSnippet('## Heading\n**bold** and `code`'), 'Heading bold and code')
  assert.equal(plainTextSnippet('- item one\n- item two'), 'item one item two')
  assert.equal(plainTextSnippet('> quoted line'), 'quoted line')
  assert.equal(plainTextSnippet('See [the docs](https://example.com) now'), 'See the docs now')
  assert.equal(plainTextSnippet('![alt text](https://example.com/a.png)'), 'alt text')
})

test('script and style content never reaches the subtitle', () => {
  assert.equal(plainTextSnippet('<style>.a{color:red}</style>Real text'), 'Real text')
  assert.equal(plainTextSnippet('<script>alert(1)</script>Real text'), 'Real text')
})

test('plain prose and empty input are left alone', () => {
  assert.equal(plainTextSnippet('User loves Celsius energy powder packets.'), 'User loves Celsius energy powder packets.')
  assert.equal(plainTextSnippet(''), '')
  assert.equal(plainTextSnippet(undefined), '')
})
