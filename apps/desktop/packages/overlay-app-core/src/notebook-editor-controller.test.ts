import assert from 'node:assert/strict'
import test from 'node:test'

import { NotebookEditorController, type NotebookEditorSaveResult } from './notebook-editor-controller'

const note = (id: string, content = '') => ({ id, title: `Note ${id}`, content, revision: '1' })
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('programmatic hydration never marks a note dirty', () => {
  const controller = new NotebookEditorController({ save: async () => ({}) })
  const token = controller.beginHydration('a')
  assert.equal(controller.snapshot().hydrating, true)
  assert.equal(controller.hydrate(note('a'), token), true)
  assert.equal(controller.snapshot().dirty, false)
})

test('one user edit burst produces one coalesced save', async () => {
  const requests: string[] = []
  const controller = new NotebookEditorController({
    debounceMs: 5,
    save: async (request) => {
      requests.push(request.content)
      return { document: { ...request, revision: '2' } }
    },
  })
  controller.select(note('a'))
  controller.edit({ content: 'o' })
  controller.edit({ content: 'ov' })
  controller.edit({ content: 'overlay' })
  await wait(20)
  assert.deepEqual(requests, ['overlay'])
  assert.equal(controller.snapshot().dirty, false)
})

test('switching notes flushes at most one pending save', async () => {
  let saves = 0
  const controller = new NotebookEditorController({
    debounceMs: 100,
    save: async (request) => {
      saves += 1
      return { document: request }
    },
  })
  controller.select(note('a'))
  controller.edit({ content: 'changed' })
  const token = controller.beginHydration('b')
  controller.hydrate(note('b'), token)
  await wait(0)
  assert.equal(saves, 1)
  assert.equal(controller.snapshot().selectedId, 'b')
})

test('stale save and hydration responses cannot overwrite the selected note', async () => {
  let resolveSave!: (result: NotebookEditorSaveResult) => void
  const controller = new NotebookEditorController({
    save: () => new Promise((resolve) => { resolveSave = resolve }),
  })
  controller.select(note('a'))
  controller.edit({ content: 'draft a' })
  const saving = controller.flush()
  const tokenB = controller.beginHydration('b')
  controller.hydrate(note('b', 'content b'), tokenB)
  assert.equal(controller.hydrate(note('a', 'late a'), tokenB - 1), false)
  resolveSave({ document: { ...note('a', 'saved a'), revision: '2' } })
  await saving
  assert.equal(controller.snapshot().selectedId, 'b')
  assert.equal(controller.snapshot().content, 'content b')
})

test('revision conflicts preserve the local draft', async () => {
  const controller = new NotebookEditorController({
    save: async () => ({ conflict: { localRevision: '1', remoteRevision: '2', message: 'Remote note changed' } }),
  })
  controller.select(note('a', 'remote'))
  controller.edit({ content: 'local draft' })
  await controller.flush()
  assert.equal(controller.snapshot().content, 'local draft')
  assert.equal(controller.snapshot().dirty, true)
  assert.equal(controller.snapshot().conflict?.remoteRevision, '2')
})

test('hydrating 100 notes causes zero writes', () => {
  let saves = 0
  const controller = new NotebookEditorController({
    save: async () => {
      saves += 1
      return {}
    },
  })
  for (let index = 0; index < 100; index += 1) {
    const token = controller.beginHydration(String(index))
    assert.equal(controller.hydrate(note(String(index), `content ${index}`), token), true)
  }
  assert.equal(saves, 0)
  assert.equal(controller.snapshot().dirty, false)
})

test('a 100-edit burst produces one bounded save', async () => {
  const requests: string[] = []
  const controller = new NotebookEditorController({
    debounceMs: 5,
    save: async (request) => {
      requests.push(request.content)
      return { document: { ...request, revision: '2' } }
    },
  })
  controller.select(note('burst'))
  for (let index = 1; index <= 100; index += 1) controller.edit({ content: `edit ${index}` })
  await wait(20)
  assert.deepEqual(requests, ['edit 100'])
})
