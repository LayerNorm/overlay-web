import assert from 'node:assert/strict'
import test from 'node:test'
import { internalFileIdFromHref } from './internal-file-link'

const origin = 'https://www.getoverlay.io'

test('Overlay file, Files and Notes links resolve to their file id', () => {
  assert.equal(internalFileIdFromHref('/api/v1/files/abc%3A1/content', origin), 'abc:1')
  assert.equal(internalFileIdFromHref(`${origin}/api/v1/files/vid1/content`, origin), 'vid1')
  assert.equal(internalFileIdFromHref('/app/files?file=f1', origin), 'f1')
  assert.equal(internalFileIdFromHref('/app/w/northwind/files?file=f2', origin), 'f2')
  assert.equal(internalFileIdFromHref('/app/notes?id=n1&scope=personal', origin), 'n1')
})

test('other links are not file links', () => {
  assert.equal(internalFileIdFromHref('https://example.com/api/v1/files/x/content', origin), null)
  assert.equal(internalFileIdFromHref('/app/files', origin), null)
  assert.equal(internalFileIdFromHref('/app/agents?agent=a', origin), null)
  assert.equal(internalFileIdFromHref('mailto:a@b.c', origin), null)
})
