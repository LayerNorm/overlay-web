import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import {
  createFixtureKnowledgeSurfaceAdapters,
  normalizeKnowledgeSurfaceNode,
  type KnowledgeFileNode,
} from '@overlay/app-core'
import { SharedKnowledgeSurface, type ControlledKnowledgeFileSnapshot } from './surface'

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
      saveContent: async () => true,
      upload: async () => ({ ok: true }),
      isEditable: () => false,
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

test('controlled native file snapshots bypass legacy list and subscription paths', async () => {
  let listCalls = 0
  let subscribeCalls = 0
  const snapshot: ControlledKnowledgeFileSnapshot = {
    nodes: [fileA],
    loading: false,
    error: null,
    truncated: false,
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
  }
  await act(async () => {
    renderer.update(React.createElement(SharedKnowledgeSurface, createSurfaceProps({
      snapshot: revoked,
      routeFile: fileB._id,
      getFile,
    })))
  })
  assert.deepEqual(viewer(renderer), [])
  await act(async () => renderer.unmount())
})

test('remote metadata revisions preserve a dirty draft and report the conflict', async () => {
  let resolveFile: ((value: KnowledgeFileNode) => void) | undefined
  const getFile = () => new Promise<KnowledgeFileNode>((resolve) => { resolveFile = resolve })
  const original: KnowledgeFileNode = { ...fileA, name: 'A.md', updatedAt: 10 }
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
  await act(async () => renderer.unmount())
})
