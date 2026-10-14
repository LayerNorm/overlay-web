import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WorkInputError,
  parseAddWorkComment,
  parseCreateWorkItem,
  parseMoveWorkItem,
  parseUpdateWorkItem,
} from './work-input'

test('create needs a title and keeps only what was sent', () => {
  assert.deepEqual(parseCreateWorkItem({ title: 'Ship', extra: 1 }), { title: 'Ship' })
  assert.deepEqual(
    parseCreateWorkItem({ title: 'Ship', scope: 'workspace', status: 'progress', priority: 3, dueDate: '2026-03-01', doneWhen: [{ text: 'Tests', checked: true }, { text: 'Docs' }] }),
    { title: 'Ship', scope: 'workspace', status: 'progress', priority: 3, dueDate: '2026-03-01', doneWhen: [{ text: 'Tests', checked: true }, { text: 'Docs', checked: false }] },
  )
  assert.throws(() => parseCreateWorkItem({}), WorkInputError)
  assert.throws(() => parseCreateWorkItem(null), WorkInputError)
  assert.throws(() => parseCreateWorkItem([]), WorkInputError)
  assert.throws(() => parseCreateWorkItem({ title: 5 }), /text/)
  assert.throws(() => parseCreateWorkItem({ title: 'x', scope: 'everyone' }), /scope/)
  assert.throws(() => parseCreateWorkItem({ title: 'x', status: 'canceled' }), /status/)
  assert.throws(() => parseCreateWorkItem({ title: 'x', priority: 9 }), /priority/)
  assert.throws(() => parseCreateWorkItem({ title: 'x', doneWhen: 'no' }), /list/)
  assert.throws(() => parseCreateWorkItem({ title: 'x', doneWhen: [{ checked: true }] }), /text/)
  assert.throws(() => parseCreateWorkItem({ title: 'x', context: [{ type: 'video', id: '1', label: 'x' }] }), /type/)
})

test('update lets null clear a field and leaves absent fields alone', () => {
  assert.deepEqual(parseUpdateWorkItem({}), {})
  assert.deepEqual(
    parseUpdateWorkItem({ description: null, assigneePrincipalId: null, dueDate: null, parentId: null, blocked: true, status: 'done' }),
    { description: null, assigneePrincipalId: null, dueDate: null, parentId: null, blocked: true, status: 'done' },
  )
  assert.deepEqual(parseUpdateWorkItem({ context: [{ type: 'link', id: 'https://a.test', label: 'A' }] }), { context: [{ type: 'link', id: 'https://a.test', label: 'A' }] })
  assert.throws(() => parseUpdateWorkItem({ blocked: 'yes' }), /blocked/)
  assert.throws(() => parseUpdateWorkItem({ title: null }), /text/)
  assert.throws(() => parseUpdateWorkItem({ dueDate: 20260101 }), /text or null/)
})

test('move and comment bodies', () => {
  assert.deepEqual(parseMoveWorkItem({ status: 'review', afterId: 'a', beforeId: null }), { status: 'review', afterId: 'a', beforeId: null })
  assert.deepEqual(parseMoveWorkItem({}), {})
  assert.throws(() => parseMoveWorkItem({ status: 'x' }), WorkInputError)
  assert.deepEqual(parseAddWorkComment({ body: 'hi' }), { body: 'hi' })
  assert.throws(() => parseAddWorkComment({}), /required/)
})
