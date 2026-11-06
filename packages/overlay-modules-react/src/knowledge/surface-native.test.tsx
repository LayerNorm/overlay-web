import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import {
  createFixtureKnowledgeSurfaceAdapters,
  normalizeKnowledgeSurfaceNode,
  type KnowledgeFileNode,
} from '@overlay/app-core'
import { SharedKnowledgeSurface, type ControlledKnowledgeFileSnapshot } from './surface'

const requestAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
const cancelAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')

before(() => {
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0) as unknown as number
  globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle)
})

after(() => {
  if (requestAnimationFrameDescriptor) Object.defineProperty(globalThis, 'requestAnimationFrame', requestAnimationFrameDescriptor)
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  if (cancelAnimationFrameDescriptor) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancelAnimationFrameDescriptor)
  else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
})

const fileA: KnowledgeFileNode = {
  _id: 'file-a',
  name: 'A.txt',
  type: 'file',
  kind: 'upload',
  parentId: null,
  createdAt: 1,
  updatedAt: 10,
}

const fileB: KnowledgeFileNode = {
  _id: 'file-b',
  name: 'B.txt',
  type: 'file',
  kind: 'upload',
  parentId: null,
  createdAt: 2,
  updatedAt: 20,
}

function createSurfaceProps(options: {
  snapshot: ControlledKnowledgeFileSnapshot
  routeFile: string | null
  getFile(id: string, signal?: AbortSignal): Promise<KnowledgeFileNode | null>
  saveContent?(fileId: string, content: string, expectedUpdatedAt?: number): Promise<boolean | { updatedAt: number }>
  rename?(input: { id: string; name: string; expectedRevision?: string }): Promise<KnowledgeFileNode>
  isEditable?: () => boolean
  onList?(): void
  onSubscribe?(): void
}) {
  const fixture = createFixtureKnowledgeSurfaceAdapters({
    nodes: [fileA, fileB].map((file) => normalizeKnowledgeSurfaceNode(file)),
  })
  const adapters = {
    ...fixture,
    repository: {
      ...fixture.repository,
      async list() {
        options.onList?.()
        return { nodes: [fileA, fileB].map((file) => normalizeKnowledgeSurfaceNode(file)), revision: '1' }
      },
      async get(id: string, signal?: AbortSignal) {
        const file = await options.getFile(id, signal)
        return file ? normalizeKnowledgeSurfaceNode(file) : null
      },
      async rename(input: { id: string; name: string; expectedRevision?: string }) {
        return options.rename
          ? normalizeKnowledgeSurfaceNode(await options.rename(input))
          : fixture.repository.rename(input)
      },
      subscribe(listener: Parameters<typeof fixture.repository.subscribe>[0]) {
        options.onSubscribe?.()
        return fixture.repository.subscribe(listener)
      },
    },
  }
  return {
    mode: 'files' as const,
    initialMemories: [],
    route: {
      file: options.routeFile,
      memory: null,
      folder: null,
      view: 'files',
      layout: 'list',
      outputFilter: null,
    },
    onUpdateQuery() {},
    adapters,
    memories: { list: async () => [], create: async () => ({ ok: true }), delete: async () => true },
    files: {
      saveContent: options.saveContent ?? (async () => true),
      upload: async () => ({ ok: true }),
      isEditable: options.isEditable ?? (() => false),
      contentUrl: () => undefined,
      entityChanged() {},
    },
    renderFileViewer: ({ file, name, content }: { file: KnowledgeFileNode; name: string; content: string }) => (
      <div data-viewer-file={file._id}>{name}:{content}</div>
    ),
    controlledFileSnapshot: options.snapshot,
  }
}

function viewer(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => node.props['data-viewer-file'] !== undefined)
    .map((node) => ({ id: node.props['data-viewer-file'], text: node.children.join('') }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('controlled native file snapshots bypass legacy list and subscription paths', async () => {
  let listCalls = 0
  let subscribeCalls = 0
  const snapshot: ControlledKnowledgeFileSnapshot = {
    nodes: [fileA],
    loading: false,
    error: null,
    truncated: true,
    detailFileId: null,
    detail: null,
    detailLoading: false,
    detailError: null,
  }
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(React.createElement(SharedKnowledgeSurface, createSurfaceProps({
      snapshot,
      routeFile: null,
      getFile: async () => null,
      onList: () => { listCalls += 1 },
      onSubscribe: () => { subscribeCalls += 1 },
    })))
  })
  assert.equal(listCalls, 0)
  assert.equal(subscribeCalls, 0)
  assert.equal(renderer.root.findAll((node) => node.children.join('') === 'Only part of this file list is shown.').length, 1)
  await act(async () => renderer.update(React.createElement(SharedKnowledgeSurface, createSurfaceProps({
    snapshot: { ...snapshot, truncated: false },
    routeFile: null,
    getFile: async () => null,
  }))))
  assert.equal(renderer.root.findAll((node) => node.children.join('') === 'Only part of this file list is shown.').length, 0)
  await act(async () => renderer.unmount())
})

test('file selection shows B immediately and ignores A content arriving late', async () => {
  const pending = new Map<string, (value: KnowledgeFileNode) => void>()
  const getFile = (id: string) => new Promise<KnowledgeFileNode>((resolve) => pending.set(id, resolve))
  const snapshotA: ControlledKnowledgeFileSnapshot = {
    nodes: [fileA, fileB],
    loading: false,
    error: null,
    truncated: false,
    detailFileId: fileA._id,
    detail: fileA,
    detailLoading: false,
    detailError: null,
  }
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(React.createElement(SharedKnowledgeSurface, createSurfaceProps({
      snapshot: snapshotA,
      routeFile: fileA._id,
      getFile,
    })))
  })
  assert.deepEqual(viewer(renderer), [{ id: fileA._id, text: 'A.txt:' }])

  const snapshotB: ControlledKnowledgeFileSnapshot = { ...snapshotA, detailFileId: fileB._id, detail: fileB }
  await act(async () => {
    renderer.update(React.createElement(SharedKnowledgeSurface, createSurfaceProps({
      snapshot: snapshotB,
      routeFile: fileB._id,
      getFile,
    })))
  })
  assert.deepEqual(viewer(renderer), [{ id: fileB._id, text: 'B.txt:' }])

  await act(async () => {
    pending.get(fileA._id)?.({ ...fileA, textContent: 'late A content' })
  })
  assert.deepEqual(viewer(renderer), [{ id: fileB._id, text: 'B.txt:' }])

  await act(async () => {
    pending.get(fileB._id)?.({ ...fileB, textContent: 'B content' })
  })
  assert.deepEqual(viewer(renderer), [{ id: fileB._id, text: 'B.txt:B content' }])

  const revoked: ControlledKnowledgeFileSnapshot = {
    ...snapshotB,
    detail: null,
    detailLoading: false,
    detailError: 'Permission denied.',
  }
  await act(async () => {
    renderer.update(React.createElement(SharedKnowledgeSurface, createSurfaceProps({
      snapshot: revoked,
      routeFile: fileB._id,
      getFile,
    })))
  })
  assert.deepEqual(viewer(renderer), [])
  assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'This file is unavailable.')
  await act(async () => {
    renderer.update(React.createElement(SharedKnowledgeSurface, createSurfaceProps({
      snapshot: { ...revoked, detailError: null, nodes: [] },
      routeFile: fileB._id,
      getFile,
    })))
  })
  assert.deepEqual(viewer(renderer), [])
  assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'This file is unavailable.')
  await act(async () => renderer.unmount())
})

test('content from a different metadata revision is never shown', async () => {
  let resolveFile: ((value: KnowledgeFileNode) => void) | undefined
  const getFile = () => new Promise<KnowledgeFileNode>((resolve) => { resolveFile = resolve })
  const snapshot: ControlledKnowledgeFileSnapshot = {
    nodes: [fileA],
    loading: false,
    error: null,
    truncated: false,
    detailFileId: fileA._id,
    detail: fileA,
    detailLoading: false,
    detailError: null,
  }
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(React.createElement(SharedKnowledgeSurface, createSurfaceProps({
      snapshot,
      routeFile: fileA._id,
      getFile,
    })))
  })
  await act(async () => {
    resolveFile?.({ ...fileA, updatedAt: 9, textContent: 'stale revision content' })
  })
  assert.deepEqual(viewer(renderer), [{ id: fileA._id, text: 'A.txt:' }])
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /changed while it was opening/)
  await act(async () => renderer.unmount())
})

test('remote metadata revisions preserve a dirty draft and report the conflict', async () => {
  let resolveFile: ((value: KnowledgeFileNode) => void) | undefined
  const getFile = () => new Promise<KnowledgeFileNode>((resolve) => { resolveFile = resolve })
  const original: KnowledgeFileNode = { ...fileA, updatedAt: 10 }
  const snapshot: ControlledKnowledgeFileSnapshot = {
    nodes: [original],
    loading: false,
    error: null,
    truncated: false,
    detailFileId: original._id,
    detail: original,
    detailLoading: false,
    detailError: null,
  }
  const makeProps = (current: ControlledKnowledgeFileSnapshot) => ({
    ...createSurfaceProps({ snapshot: current, routeFile: original._id, getFile }),
    files: {
      saveContent: async () => true,
      upload: async () => ({ ok: true }),
      isEditable: () => true,
      contentUrl: () => undefined,
      entityChanged() {},
    },
  })
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(React.createElement(SharedKnowledgeSurface, makeProps(snapshot)))
  })
  await act(async () => {
    resolveFile?.({ ...original, textContent: 'server content' })
  })
  const textarea = renderer.root.findByType('textarea')
  await act(async () => textarea.props.onChange({ target: { value: 'my draft' } }))

  const changed = { ...original, updatedAt: 11 }
  const remoteSnapshot: ControlledKnowledgeFileSnapshot = {
    ...snapshot,
    nodes: [changed],
    detail: changed,
  }
  await act(async () => renderer.update(React.createElement(SharedKnowledgeSurface, makeProps(remoteSnapshot))))
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /draft is still here/)
  assert.equal(renderer.root.findByType('textarea').props.value, 'my draft')
  assert.equal(renderer.root.findByType('textarea').props.readOnly, true)
  await act(async () => renderer.unmount())
})

test('content saves use the selected metadata revision', async () => {
  let resolveFile: ((value: KnowledgeFileNode) => void) | undefined
  const getFile = () => new Promise<KnowledgeFileNode>((resolve) => { resolveFile = resolve })
  const saved: Array<{ id: string; content: string; expectedUpdatedAt: number | undefined }> = []
  const snapshot: ControlledKnowledgeFileSnapshot = {
    nodes: [fileA],
    loading: false,
    error: null,
    truncated: false,
    detailFileId: fileA._id,
    detail: fileA,
    detailLoading: false,
    detailError: null,
  }
  const baseProps = createSurfaceProps({ snapshot, routeFile: fileA._id, getFile })
  const props = {
    ...baseProps,
    files: {
      ...baseProps.files,
      isEditable: () => true,
      async saveContent(id: string, content: string, expectedUpdatedAt?: number) {
        saved.push({ id, content, expectedUpdatedAt })
        return true
      },
    },
  }
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(React.createElement(SharedKnowledgeSurface, props))
  })
  await act(async () => {
    resolveFile?.({ ...fileA, textContent: 'server content' })
  })
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'draft' } }))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 850))
  })
  assert.deepEqual(saved, [{ id: fileA._id, content: 'draft', expectedUpdatedAt: fileA.updatedAt }])
  await act(async () => renderer.unmount())
})

test('a native content save acknowledges a subscription revision delivered before its response', async () => {
  const save = deferred<boolean | { updatedAt: number }>()
  const snapshot: ControlledKnowledgeFileSnapshot = {
    nodes: [fileA],
    loading: false,
    error: null,
    truncated: false,
    detailFileId: fileA._id,
    detail: fileA,
    detailLoading: false,
    detailError: null,
  }
  const makeProps = (current: ControlledKnowledgeFileSnapshot) => createSurfaceProps({
    snapshot: current,
    routeFile: fileA._id,
    getFile: async () => ({ ...fileA, textContent: 'server content' }),
    saveContent: async () => save.promise,
    isEditable: () => true,
  })
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(React.createElement(SharedKnowledgeSurface, makeProps(snapshot)))
  })
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'saved draft' } }))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 850)))

  const updated = { ...fileA, updatedAt: 11 }
  await act(async () => renderer.update(React.createElement(SharedKnowledgeSurface, makeProps({
    ...snapshot,
    nodes: [updated],
    detail: updated,
  }))))
  await act(async () => save.resolve({ updatedAt: 11 }))

  assert.equal(renderer.root.findByType('textarea').props.value, 'saved draft')
  assert.equal(renderer.root.findByType('textarea').props.readOnly, false)
  assert.equal(renderer.root.findAll((node) => node.children.join('').includes('draft is still here')).length, 0)
  await act(async () => renderer.unmount())
})

test('a native rename acknowledges its subscribed revision without a false conflict', async () => {
  const rename = deferred<KnowledgeFileNode>()
  const snapshot: ControlledKnowledgeFileSnapshot = {
    nodes: [fileA],
    loading: false,
    error: null,
    truncated: false,
    detailFileId: fileA._id,
    detail: fileA,
    detailLoading: false,
    detailError: null,
  }
  const makeProps = (current: ControlledKnowledgeFileSnapshot) => createSurfaceProps({
    snapshot: current,
    routeFile: fileA._id,
    getFile: async () => ({ ...fileA, textContent: 'server content' }),
    rename: async () => rename.promise,
  })
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(React.createElement(SharedKnowledgeSurface, makeProps(snapshot)))
  })
  await act(async () => renderer.root.findByProps({ 'aria-label': 'File title' }).props.onChange({
    target: { value: 'Renamed.txt' },
  }))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 650)))

  const renamed = { ...fileA, name: 'Renamed.txt', updatedAt: 11 }
  await act(async () => renderer.update(React.createElement(SharedKnowledgeSurface, makeProps({
    ...snapshot,
    nodes: [renamed],
    detail: renamed,
  }))))
  await act(async () => rename.resolve(renamed))

  assert.equal(renderer.root.findByProps({ 'aria-label': 'File title' }).props.value, 'Renamed.txt')
  assert.equal(renderer.root.findAll((node) => node.children.join('').includes('title draft is still here')).length, 0)
  await act(async () => renderer.unmount())
})

test('content and title saves serialize newer drafts onto their authoritative acknowledgments', async () => {
  const contentSaves: Array<ReturnType<typeof deferred<boolean | { updatedAt: number }>>> = []
  const renames: Array<ReturnType<typeof deferred<KnowledgeFileNode>>> = []
  const contentRevisions: Array<number | undefined> = []
  const titleRevisions: Array<string | undefined> = []
  const savedContents: string[] = []
  const savedTitles: string[] = []
  let snapshot: ControlledKnowledgeFileSnapshot = {
    nodes: [fileA],
    loading: false,
    error: null,
    truncated: false,
    detailFileId: fileA._id,
    detail: fileA,
    detailLoading: false,
    detailError: null,
  }
  const makeProps = () => createSurfaceProps({
    snapshot,
    routeFile: fileA._id,
    getFile: async () => ({ ...fileA, textContent: 'server content' }),
    saveContent: async (_id, _content, revision) => {
      contentRevisions.push(revision)
      savedContents.push(_content)
      const request = deferred<boolean | { updatedAt: number }>()
      contentSaves.push(request)
      return request.promise
    },
    rename: async (input) => {
      titleRevisions.push(input.expectedRevision)
      savedTitles.push(input.name)
      const request = deferred<KnowledgeFileNode>()
      renames.push(request)
      return request.promise
    },
    isEditable: () => true,
  })
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(React.createElement(SharedKnowledgeSurface, makeProps()))
  })

  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'first draft' } }))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 850)))
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'newer draft' } }))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 850)))
  assert.equal(contentSaves.length, 1)
  snapshot = { ...snapshot, nodes: [{ ...fileA, updatedAt: 11 }], detail: { ...fileA, updatedAt: 11 } }
  await act(async () => renderer.update(React.createElement(SharedKnowledgeSurface, makeProps())))
  assert.equal(renderer.root.findByType('textarea').props.readOnly, false)
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0)
  await act(async () => contentSaves[0]!.resolve({ updatedAt: 11 }))
  assert.equal(contentSaves.length, 2)
  assert.deepEqual(contentRevisions, [10, 11])
  assert.deepEqual(savedContents, ['first draft', 'newer draft'])
  await act(async () => contentSaves[1]!.resolve({ updatedAt: 12 }))
  assert.equal(renderer.root.findByType('textarea').props.value, 'newer draft')
  assert.equal(renderer.root.findByType('textarea').props.readOnly, false)
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0)

  await act(async () => renderer.root.findByProps({ 'aria-label': 'File title' }).props.onChange({
    target: { value: 'First title' },
  }))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 650)))
  await act(async () => renderer.root.findByProps({ 'aria-label': 'File title' }).props.onChange({
    target: { value: 'Newer title' },
  }))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 650)))
  assert.equal(renames.length, 1)
  await act(async () => renames[0]!.resolve({ ...fileA, name: 'First title', updatedAt: 13 }))
  assert.equal(renames.length, 2)
  assert.deepEqual(titleRevisions, ['12', '13'])
  assert.deepEqual(savedTitles, ['First title', 'Newer title'])
  await act(async () => renames[1]!.resolve({ ...fileA, name: 'Newer title', updatedAt: 14 }))
  assert.equal(renderer.root.findByProps({ 'aria-label': 'File title' }).props.value, 'Newer title')
  assert.notEqual(renderer.root.findByProps({ 'aria-label': 'File title' }).props.readOnly, true)
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0)
  await act(async () => renderer.unmount())
})

for (const outcome of ['remote', 'legacy', 'failure'] as const) {
  test(`a queued newer content draft stays conservative after ${outcome}`, async () => {
    const save = deferred<boolean | { updatedAt: number }>()
    let calls = 0
    let snapshot: ControlledKnowledgeFileSnapshot = {
      nodes: [fileA], loading: false, error: null, truncated: false,
      detailFileId: fileA._id, detail: fileA, detailLoading: false, detailError: null,
    }
    const makeProps = () => createSurfaceProps({
      snapshot,
      routeFile: fileA._id,
      getFile: async () => ({ ...fileA, textContent: 'server content' }),
      saveContent: async () => { calls += 1; return save.promise },
      isEditable: () => true,
    })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(React.createElement(SharedKnowledgeSurface, makeProps())) })
    await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'first draft' } }))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 850)))
    await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'newer draft' } }))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 850)))
    assert.equal(calls, 1)
    if (outcome !== 'failure') {
      const remote = { ...fileA, updatedAt: outcome === 'remote' ? 99 : 11 }
      snapshot = { ...snapshot, nodes: [remote], detail: remote }
      await act(async () => renderer.update(React.createElement(SharedKnowledgeSurface, makeProps())))
    }
    await act(async () => {
      if (outcome === 'failure') save.reject(new Error('Save failed'))
      else save.resolve(outcome === 'legacy' ? true : { updatedAt: 11 })
    })
    assert.equal(calls, 1)
    if (outcome === 'failure') assert.match(JSON.stringify(renderer.toJSON()), /newer draft/)
    else assert.equal(renderer.root.findByType('textarea').props.value, 'newer draft')
    assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''),
      outcome === 'failure' ? /Save failed/ : /changed elsewhere/)
    await act(async () => renderer.unmount())
  })
}

test('late native save acknowledgements cannot update a switched or denied file selection', async () => {
  const switchSave = deferred<boolean | { updatedAt: number }>()
  const deniedSave = deferred<boolean | { updatedAt: number }>()
  const snapshot: ControlledKnowledgeFileSnapshot = {
    nodes: [fileA, fileB],
    loading: false,
    error: null,
    truncated: false,
    detailFileId: fileA._id,
    detail: fileA,
    detailLoading: false,
    detailError: null,
  }
  const makeProps = (
    current: ControlledKnowledgeFileSnapshot,
    routeFile: string,
    save: ReturnType<typeof deferred<boolean | { updatedAt: number }>>,
  ) => createSurfaceProps({
    snapshot: current,
    routeFile,
    getFile: async (id) => ({ ...(id === fileB._id ? fileB : fileA), textContent: `${id} content` }),
    saveContent: async () => save.promise,
    isEditable: () => true,
  })
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(React.createElement(SharedKnowledgeSurface, makeProps(snapshot, fileA._id, switchSave)))
  })
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'A draft' } }))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 850)))
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'Pending A draft' } }))
  const snapshotB = { ...snapshot, detailFileId: fileB._id, detail: fileB }
  await act(async () => renderer.update(React.createElement(SharedKnowledgeSurface, makeProps(snapshotB, fileB._id, switchSave))))
  assert.equal(renderer.root.findByType('textarea').props.value, `${fileB._id} content`)
  await act(async () => switchSave.resolve({ updatedAt: 11 }))
  assert.equal(renderer.root.findByType('textarea').props.value, `${fileB._id} content`)

  const snapshotA = { ...snapshot, detailFileId: fileA._id, detail: fileA }
  await act(async () => renderer.update(React.createElement(SharedKnowledgeSurface, makeProps(snapshotA, fileA._id, deniedSave))))
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'Denied draft' } }))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 850)))
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'Pending denied draft' } }))
  const denied: ControlledKnowledgeFileSnapshot = {
    ...snapshotA,
    nodes: [],
    detail: null,
    detailLoading: false,
    detailError: 'Permission denied.',
  }
  await act(async () => renderer.update(React.createElement(SharedKnowledgeSurface, makeProps(denied, fileA._id, deniedSave))))
  await act(async () => deniedSave.resolve({ updatedAt: 12 }))
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'File title' }).length, 0)
  assert.equal(renderer.root.findAllByType('textarea').length, 0)
  assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'This file is unavailable.')
  await act(async () => renderer.unmount())
})
