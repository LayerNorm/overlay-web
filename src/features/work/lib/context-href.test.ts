import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workContextHref } from './context-href'
test('context links use scoped resource routes and reject unsafe external protocols', () => {
  assert.equal(
    workContextHref({ type: 'chat', id: 'chat id', label: 'chat' }, 'ws'),
    '/app/w/ws/chat?id=chat%20id',
  )
  assert.equal(
    workContextHref({ type: 'note', id: 'note', label: 'note' }, 'ws'),
    '/app/w/ws/notes?id=note',
  )
  assert.equal(
    workContextHref({ type: 'file', id: 'file', label: 'file' }, 'ws'),
    '/app/w/ws/files?file=file',
  )
  assert.equal(
    workContextHref({ type: 'link', id: 'javascript:alert(1)', label: 'bad' }, 'ws'),
    undefined,
  )
})
