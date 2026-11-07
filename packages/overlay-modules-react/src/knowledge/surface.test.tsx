import assert from 'node:assert/strict'
import test from 'node:test'
import { createFixtureKnowledgeSurfaceAdapters, type KnowledgeFileNode } from '@overlay/app-core'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SharedKnowledgeSurface } from './surface'

const files: KnowledgeFileNode[] = [
  { _id: 'folder', name: 'Projects', type: 'folder', kind: 'folder', parentId: null, createdAt: 1, updatedAt: 1 },
  { _id: 'note', name: 'Parity note', type: 'file', kind: 'note', parentId: null, previewText: 'Source of truth', createdAt: 1, updatedAt: 2 },
]

test('shared surface preserves the web files markup and controls', () => {
  const html = renderToStaticMarkup(
    <SharedKnowledgeSurface
      mode="files"
      liveFiles={files}
      initialMemories={[]}
      route={{ file: null, memory: null, folder: null, view: 'all', layout: 'list', outputFilter: null }}
      onUpdateQuery={() => undefined}
      adapters={createFixtureKnowledgeSurfaceAdapters({ nodes: files.map((file) => ({ ...file, id: file._id, kind: file.kind === 'folder' ? 'folder' : file.kind === 'note' ? 'note' : 'file' })) })}
      memories={{ list: async () => [], create: async () => ({ ok: true }), delete: async () => true }}
      files={{
        saveContent: async () => true,
        upload: async () => ({ ok: true }),
        isEditable: () => false,
        contentUrl: () => undefined,
      }}
      renderFileViewer={() => null}
    />,
  )
  assert.match(html, /overlay-knowledge-surface/)
  assert.match(html, /All/)
  assert.match(html, /Projects/)
  assert.match(html, /Parity note/)
  assert.match(html, /overlay-knowledge-list/)
  assert.match(html, /aria-label="Search files"/)
  assert.match(html, /aria-label="List layout" aria-pressed="true"/)
})

test('folder navigation exposes a screen-reader breadcrumb contract', () => {
  const html = renderToStaticMarkup(
    <SharedKnowledgeSurface
      mode="files"
      liveFiles={files}
      initialMemories={[]}
      route={{ file: null, memory: null, folder: 'folder', view: 'all', layout: 'list', outputFilter: null }}
      onUpdateQuery={() => undefined}
      adapters={createFixtureKnowledgeSurfaceAdapters({ nodes: files.map((file) => ({ ...file, id: file._id, kind: file.kind === 'folder' ? 'folder' : file.kind === 'note' ? 'note' : 'file' })) })}
      memories={{ list: async () => [], create: async () => ({ ok: true }), delete: async () => true }}
      files={{
        saveContent: async () => true,
        upload: async () => ({ ok: true }),
        isEditable: () => false,
        contentUrl: () => undefined,
      }}
      renderFileViewer={() => null}
    />,
  )
  assert.match(html, /aria-label="Folder breadcrumbs"/)
  assert.match(html, /aria-current="page"/)
})

function renderSurface(props: { liveFiles: readonly KnowledgeFileNode[] | null | undefined; file?: string | null }) {
  return renderToStaticMarkup(
    <SharedKnowledgeSurface
      mode="files"
      liveFiles={props.liveFiles}
      initialMemories={[]}
      route={{ file: props.file ?? null, memory: null, folder: null, view: 'all', layout: 'list', outputFilter: null }}
      onUpdateQuery={() => undefined}
      adapters={createFixtureKnowledgeSurfaceAdapters()}
      memories={{ list: async () => [], create: async () => ({ ok: true }), delete: async () => true }}
      files={{
        saveContent: async () => true,
        upload: async () => ({ ok: true }),
        isEditable: () => false,
        contentUrl: () => undefined,
      }}
      renderFileViewer={({ name, content }) => <div data-viewer={name}>{content || 'text pending'}</div>}
    />,
  )
}

test('a file opens from its live metadata before its text loads', () => {
  const doc: KnowledgeFileNode = { _id: 'doc', name: 'Plan.md', type: 'file', kind: 'upload', parentId: null, createdAt: 1, updatedAt: 3 }
  const html = renderSurface({ liveFiles: [...files, doc], file: 'doc' })
  assert.match(html, /data-viewer="Plan.md"/)
  assert.match(html, /text pending/)
})

test('the list shows loading, then an error when the scope cannot be read', () => {
  assert.match(renderSurface({ liveFiles: undefined }), /aria-busy="true"/)
  assert.match(renderSurface({ liveFiles: null }), /Could not load files/)
})
