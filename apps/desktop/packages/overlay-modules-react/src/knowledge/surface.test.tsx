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
      initialFiles={files}
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
        entityChanged: () => undefined,
      }}
      renderFileViewer={() => null}
    />,
  )
  assert.match(html, /overlay-knowledge-surface/)
  assert.match(html, /Files/)
  assert.match(html, /Projects/)
  assert.match(html, /Parity note/)
  assert.match(html, /overlay-knowledge-list/)
  assert.match(html, /title="Search files"/)
  assert.match(html, /aria-label="List layout" aria-pressed="true"/)
})

test('folder navigation exposes a screen-reader breadcrumb contract', () => {
  const html = renderToStaticMarkup(
    <SharedKnowledgeSurface
      mode="files"
      initialFiles={files}
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
        entityChanged: () => undefined,
      }}
      renderFileViewer={() => null}
    />,
  )
  assert.match(html, /aria-label="Folder breadcrumbs"/)
  assert.match(html, /aria-current="page"/)
})
