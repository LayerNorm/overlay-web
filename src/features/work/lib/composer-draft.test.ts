import assert from 'node:assert/strict'
import test from 'node:test'
import { composerRequest, emptyComposerDraft } from './composer-draft'

test('the first line is the title and remaining lines are description; fields are copied', () => {
  const draft = { ...emptyComposerDraft(), text: '  Write a plan  \r\nFirst step\r\n\r\nLast step  ', assigneePrincipalId: 'agent', startDate: '2026-11-01', dueDate: '2026-11-03', blockedBy: ['task'], status: 'backlog' as const, priority: 3 as const, context: [{ type: 'link' as const, id: 'https://example.com/', label: 'Example' }] }
  assert.deepEqual(composerRequest(draft).input, { title: 'Write a plan', description: 'First step\n\nLast step', assigneePrincipalId: 'agent', startDate: '2026-11-01', dueDate: '2026-11-03', blockedBy: ['task'], status: 'backlog', priority: 3, context: draft.context })
})

test('defaults reset every field, use Medium and Todo, and omit empty optional fields', () => {
  const draft = emptyComposerDraft()
  draft.blockedBy.push('old')
  assert.deepEqual(emptyComposerDraft(), { text: '', assigneePrincipalId: '', startDate: '', dueDate: '', blockedBy: [], status: 'todo', priority: 2, context: [] })
  assert.deepEqual(composerRequest({ ...emptyComposerDraft(), text: 'Task' }).input, { title: 'Task', status: 'todo', priority: 2, blockedBy: [], context: [] })
})

test('empty titles, long titles, invalid dates and long descriptions are refused', () => {
  for (const text of ['', '   ', '\nDescription', 'x'.repeat(201), `Title\n${'x'.repeat(20001)}`]) assert.ok(composerRequest({ ...emptyComposerDraft(), text }).error)
  assert.ok(composerRequest({ ...emptyComposerDraft(), text: 'Title', startDate: '2026-11-03', dueDate: '2026-11-01' }).error)
  assert.ok(composerRequest({ ...emptyComposerDraft(), text: 'Title', dueDate: '2026-02-30' }).error)
  assert.equal(composerRequest({ ...emptyComposerDraft(), text: 'x'.repeat(200) }).error, undefined)
})
