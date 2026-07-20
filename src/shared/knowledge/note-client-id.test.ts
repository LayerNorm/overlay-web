import assert from 'node:assert/strict'
import test from 'node:test'
import {
  selectNoteClientIdCandidate,
  type NoteClientIdCandidate,
} from './note-client-id'

function note(overrides: Partial<NoteClientIdCandidate> = {}): NoteClientIdCandidate {
  return {
    _id: 'remote-1',
    name: 'Overlay desktop todos',
    type: 'file',
    kind: 'note',
    content: '',
    updatedAt: 1,
    ...overrides,
  }
}

test('selectNoteClientIdCandidate returns an existing exact client id', () => {
  const selected = selectNoteClientIdCandidate(
    [
      note({ _id: 'older', clientId: 'local-1', updatedAt: 1 }),
      note({ _id: 'newer', clientId: 'local-1', updatedAt: 2 }),
    ],
    { clientId: 'local-1', title: 'Different local title' },
  )
  assert.equal(selected?._id, 'newer')
})

test('selectNoteClientIdCandidate claims one empty legacy mirror', () => {
  const selected = selectNoteClientIdCandidate(
    [note()],
    { clientId: 'local-1', title: ' overlay  desktop TODOS ' },
  )
  assert.equal(selected?._id, 'remote-1')
})

test('selectNoteClientIdCandidate will not claim ambiguous legacy mirrors', () => {
  const selected = selectNoteClientIdCandidate(
    [note({ _id: 'remote-1' }), note({ _id: 'remote-2' })],
    { clientId: 'local-1', title: 'Overlay desktop todos' },
  )
  assert.equal(selected, null)
})

test('selectNoteClientIdCandidate preserves a populated distinct same-title note', () => {
  const selected = selectNoteClientIdCandidate(
    [note({ content: '<p>Different content</p>', contentHash: 'different' })],
    { clientId: 'local-1', title: 'Overlay desktop todos', contentHash: 'local' },
  )
  assert.equal(selected, null)
})
