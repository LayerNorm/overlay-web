import assert from 'node:assert/strict'
import test from 'node:test'
import {
  childProjectFiles,
  childProjects,
  canMoveProjectFile,
  createProjectFolderRequest,
  createProjectNoteRequest,
  createProjectStoredFileRequest,
  createProjectTextFileRequest,
  projectFileTypeFromName,
  projectFilesExcludingNotes,
  filterProjectFilesForSearch,
  projectHubHref,
  projectItemHref,
  projectNotesFromFiles,
  projectRouteViewForFile,
  removeProjectItemFromResources,
  rootProjectFiles,
  rootProjects,
  shouldIngestProjectDocument,
  shouldUseProjectStorageUpload,
  sortProjectChats,
  sortProjectFilesByUpdated,
  sortProjectFilesForTree,
} from './projects'
import type { ProjectFileSummary, ProjectResourceItems } from './projects'
import type { ProjectSummary } from './contracts'

const projects: ProjectSummary[] = [
  { _id: 'b', name: 'Beta', parentId: null, createdAt: 1, updatedAt: 2 },
  { _id: 'a', name: 'Alpha', parentId: null, createdAt: 1, updatedAt: 3 },
  { _id: 'c', name: 'Child', parentId: 'a', createdAt: 1, updatedAt: 4 },
]

const files: ProjectFileSummary[] = [
  { _id: 'file-2', name: 'b.txt', type: 'file', kind: 'upload', parentId: null, updatedAt: 2 },
  { _id: 'folder-1', name: 'Alpha', type: 'folder', kind: 'folder', parentId: null, updatedAt: 1 },
  { _id: 'file-1', name: 'a.txt', type: 'file', kind: 'upload', parentId: 'folder-1', updatedAt: 4 },
  { _id: 'note-1', name: 'Note', type: 'file', kind: 'note', parentId: null, updatedAt: 3 },
]

test('project route helpers preserve canonical URLs', () => {
  assert.equal(projectHubHref({ _id: 'proj 1', name: 'Legal Ops' }), '/app/projects?projectId=proj%201&projectName=Legal%20Ops')
  assert.equal(
    projectItemHref({ project: { _id: 'proj 1', name: 'Legal Ops' }, view: 'chat', id: 'chat 1' }),
    '/app/projects?view=chat&id=chat%201&projectId=proj%201&projectName=Legal%20Ops',
  )
})

test('project and file helpers sort roots and children consistently', () => {
  assert.deepEqual(rootProjects(projects).map((project) => project._id), ['a', 'b'])
  assert.deepEqual(childProjects(projects, 'a').map((project) => project._id), ['c'])
  assert.deepEqual(sortProjectFilesForTree(files).map((file) => file._id), ['folder-1', 'file-1', 'file-2', 'note-1'])
  assert.deepEqual(rootProjectFiles(files).map((file) => file._id), ['folder-1', 'file-2', 'note-1'])
  assert.deepEqual(childProjectFiles(files, 'folder-1').map((file) => file._id), ['file-1'])
  assert.deepEqual(sortProjectFilesByUpdated(files).map((file) => file._id), ['file-1', 'note-1', 'file-2', 'folder-1'])
})

test('project resource transforms isolate notes and files', () => {
  assert.deepEqual(projectFilesExcludingNotes(files).map((file) => file._id), ['file-2', 'folder-1', 'file-1'])
  assert.deepEqual(filterProjectFilesForSearch(files, 'a.txt').map((file) => file._id), ['folder-1', 'file-1'])
  assert.deepEqual(projectNotesFromFiles(files.filter((file) => file.kind === 'note')), [
    { _id: 'note-1', title: 'Note', updatedAt: 3 },
  ])
  assert.deepEqual(sortProjectChats([
    { _id: 'old', title: 'Old', lastModified: 1 },
    { _id: 'new', title: 'New', updatedAt: 3 },
  ]).map((chat) => chat._id), ['new', 'old'])
  assert.equal(canMoveProjectFile(files, 'folder-1', 'file-1'), false)
  assert.equal(canMoveProjectFile(files, 'file-1', null), true)
})

test('project resource removal is scoped by item kind', () => {
  const items: ProjectResourceItems = {
    chats: [{ _id: 'chat-1', title: 'Chat' }],
    notes: [{ _id: 'note-1', title: 'Note' }],
    files: [{ _id: 'file-1', name: 'File', type: 'file', kind: 'upload', parentId: null, updatedAt: 1 }],
  }
  assert.deepEqual(removeProjectItemFromResources(items, 'note', 'note-1').notes, [])
  assert.equal(removeProjectItemFromResources(items, 'note', 'note-1').chats.length, 1)
})

test('project file routing and upload classification match existing behavior', () => {
  assert.equal(projectRouteViewForFile({ kind: 'note', name: 'Note', extension: undefined, mimeType: undefined }), 'note')
  assert.equal(projectRouteViewForFile({ kind: 'upload', name: 'readme.md', extension: undefined, mimeType: undefined }), 'note')
  assert.equal(projectRouteViewForFile({ kind: 'upload', name: 'image.png', extension: undefined, mimeType: undefined }), 'file')

  assert.equal(projectFileTypeFromName('photo.png'), 'image')
  assert.equal(projectFileTypeFromName('paper.pdf'), 'pdf')
  assert.equal(shouldIngestProjectDocument({ name: 'paper.pdf', type: 'application/pdf' }), true)
  assert.equal(shouldIngestProjectDocument({ name: 'photo.png', type: 'image/png' }), false)
  assert.equal(shouldUseProjectStorageUpload({ name: 'photo.png' }), true)
  assert.equal(shouldUseProjectStorageUpload({ name: 'notes.txt' }), false)
})

test('project file create request helpers preserve route bodies', () => {
  assert.deepEqual(createProjectNoteRequest('proj'), {
    kind: 'note',
    name: 'Untitled',
    textContent: '',
    projectId: 'proj',
  })
  assert.deepEqual(createProjectFolderRequest({ name: 'Folder', parentId: null, projectId: 'proj' }), {
    name: 'Folder',
    type: 'folder',
    parentId: null,
    projectId: 'proj',
  })
  assert.deepEqual(createProjectStoredFileRequest({
    file: { name: 'photo.png', size: 10 },
    parentId: 'folder',
    projectId: 'proj',
    r2Key: 'r2',
  }), {
    name: 'photo.png',
    type: 'file',
    parentId: 'folder',
    r2Key: 'r2',
    sizeBytes: 10,
    projectId: 'proj',
  })
  assert.deepEqual(createProjectTextFileRequest({
    file: { name: 'notes.txt' },
    parentId: null,
    projectId: 'proj',
    content: 'hello',
  }), {
    name: 'notes.txt',
    type: 'file',
    parentId: null,
    content: 'hello',
    projectId: 'proj',
  })
})
