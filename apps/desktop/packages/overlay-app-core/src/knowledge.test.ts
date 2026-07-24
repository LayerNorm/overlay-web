import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canMoveKnowledgeFile,
  collectKnowledgeFileSubtreeIds,
  createManualMemoryRequest,
  filePathLabel,
  filterKnowledgeFileNodes,
  filterMemoryRows,
  folderBreadcrumb,
  knowledgePendingPreview,
  opensInDocumentEditor,
  removeKnowledgeFileSubtrees,
  resolveKnowledgeLayout,
  resolveKnowledgeOutputFilter,
  resolveKnowledgeTab,
  sortedCurrentFolderFiles,
  sortedCurrentFolderFolders,
  sortedCurrentFolderNodes,
  type KnowledgeFileNode,
} from './knowledge'

const files: KnowledgeFileNode[] = [
  { _id: 'folder', name: 'Folder', type: 'folder', kind: 'folder', parentId: null, createdAt: 1, updatedAt: 1 },
  { _id: 'nested', name: 'Nested', type: 'folder', kind: 'folder', parentId: 'folder', createdAt: 1, updatedAt: 2 },
  { _id: 'a', name: 'A.txt', type: 'file', kind: 'upload', parentId: 'folder', extension: 'txt', createdAt: 1, updatedAt: 10 },
  { _id: 'b', name: 'B.pdf', type: 'file', kind: 'upload', parentId: null, extension: 'pdf', createdAt: 1, updatedAt: 20 },
]

test('knowledge route options resolve from query values', () => {
  assert.equal(resolveKnowledgeTab({ mode: 'files', view: 'memories' }), 'files')
  assert.equal(resolveKnowledgeTab({ mode: 'knowledge', view: 'outputs' }), 'outputs')
  assert.equal(resolveKnowledgeLayout({ layout: null, activeTab: 'outputs' }), 'cards')
  assert.equal(resolveKnowledgeLayout({ layout: 'list', activeTab: 'outputs' }), 'list')
  assert.equal(resolveKnowledgeOutputFilter('video'), 'video')
  assert.equal(resolveKnowledgeOutputFilter('unknown'), 'all')
})

test('knowledge file helpers filter, sort, and protect folder moves', () => {
  assert.deepEqual(filterKnowledgeFileNodes(files, 'a.txt').map((file) => file._id), ['folder', 'a'])
  assert.deepEqual(sortedCurrentFolderNodes(files, null).map((file) => file._id), ['folder', 'b'])
  assert.deepEqual(sortedCurrentFolderFiles(files, 'folder').map((file) => file._id), ['a'])
  assert.deepEqual(sortedCurrentFolderFolders(files, 'folder').map((file) => file._id), ['nested'])
  assert.deepEqual(folderBreadcrumb(files, files[1]!).map((file) => file._id), ['folder', 'nested'])
  assert.equal(canMoveKnowledgeFile(files, 'folder', 'nested'), false)
  assert.equal(canMoveKnowledgeFile(files, 'b', 'nested'), true)
})

test('knowledge file helpers remove deleted folders and descendants', () => {
  assert.deepEqual([...collectKnowledgeFileSubtreeIds(files, ['folder'])], ['folder', 'nested', 'a'])
  assert.deepEqual(removeKnowledgeFileSubtrees(files, ['folder']).map((file) => file._id), ['b'])
  assert.deepEqual(removeKnowledgeFileSubtrees(files, ['a', 'b']).map((file) => file._id), ['folder', 'nested'])
})

test('knowledge memory and document helpers match web behavior', () => {
  assert.equal(filePathLabel(files, files[2]!), 'Folder')
  assert.equal(opensInDocumentEditor(files[2]!), true)
  assert.equal(opensInDocumentEditor(files[3]!), false)
  assert.equal(knowledgePendingPreview(` ${'x'.repeat(170)} `).endsWith('…'), true)
  assert.deepEqual(createManualMemoryRequest('Remember this'), {
    content: 'Remember this',
    source: 'manual',
    type: 'fact',
    importance: 3,
    actor: 'user',
  })
  const memories = [
    { key: '1', memoryId: 'm1', segmentIndex: 0, content: 'Short', fullContent: 'Short body', source: 'manual', createdAt: 1 },
    { key: '2', memoryId: 'm2', segmentIndex: 0, content: 'Other', fullContent: 'Long project detail', source: 'manual', createdAt: 1 },
  ]
  assert.deepEqual(filterMemoryRows(memories, 'project').map((memory) => memory.memoryId), ['m2'])
})
