import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalFileToNotebookNote,
  createLocalNotebookNote,
  createNotebookAgentMentions,
  createNotebookDraftState,
  createNotebookFileUpdateRequest,
  createNotebookPersistedNote,
  createRenamedNotebookNote,
  markdownToNotebookHtml,
  notebookAgentEventToUiItem,
  normalizeNotebookContent,
  normalizeNotebookTitle,
  noteDocToKnowledgeFile,
  parseNotebookAgentStreamLine,
  removeNotebookNote,
  upsertNotebookNote,
} from './notes'

test('canonical note files map to notebook notes', () => {
  assert.deepEqual(canonicalFileToNotebookNote({
    _id: 'note_1',
    name: 'Plan',
    textContent: 'Body',
    projectId: 'proj_1',
    createdAt: 1,
    updatedAt: 2,
    shareVisibility: 'public',
    shareToken: 'tok',
  }), {
    _id: 'note_1',
    title: 'Plan',
    content: 'Body',
    tags: [],
    projectId: 'proj_1',
    createdAt: 1,
    updatedAt: 2,
    shareVisibility: 'public',
    shareToken: 'tok',
  })

  assert.equal(createLocalNotebookNote('note_2', 10).title, 'Untitled')
})

test('notebook note list helpers upsert, remove, and normalize titles', () => {
  const first = createLocalNotebookNote('a', 1)
  const updated = { ...first, title: 'Updated', updatedAt: 2 }
  const second = createLocalNotebookNote('b', 1)

  assert.deepEqual(upsertNotebookNote([first, second], updated).map((note) => note._id), ['a', 'b'])
  assert.equal(upsertNotebookNote([first, second], updated)[0]!.title, 'Updated')
  assert.deepEqual(removeNotebookNote([first, second], 'a').map((note) => note._id), ['b'])
  assert.equal(normalizeNotebookTitle('  '), 'Untitled')
  assert.equal(normalizeNotebookTitle('  Roadmap  '), 'Roadmap')
})

test('dedicated note records map into the file-list contract', () => {
  assert.deepEqual(noteDocToKnowledgeFile({
    _id: 'note_1',
    title: 'Architecture notes',
    content: '<p>Postgres</p>',
    tags: [],
    projectId: 'project_1',
    createdAt: 10,
    updatedAt: 20,
  }), {
    _id: 'note_1',
    name: 'Architecture notes',
    type: 'file',
    kind: 'note',
    parentId: null,
    content: '<p>Postgres</p>',
    textContent: '<p>Postgres</p>',
    previewText: '<p>Postgres</p>',
    sizeBytes: 15,
    createdAt: 10,
    updatedAt: 20,
    projectId: 'project_1',
  })
})

test('notebook request helpers preserve API body shapes', () => {
  assert.deepEqual(createNotebookFileUpdateRequest({
    noteId: 'note_1',
    title: 'Title',
    content: '<p>Body</p>',
  }), {
    fileId: 'note_1',
    name: 'Title',
    textContent: '<p>Body</p>',
  })

  assert.deepEqual(createNotebookAgentMentions([{ type: 'file', id: 'file_1', name: 'Spec' }]), [
    { type: 'file', id: 'file_1', name: 'Spec' },
  ])
})

test('notebook controllers derive draft, persisted, and renamed state', () => {
  const note = createLocalNotebookNote('note_1', 10)

  assert.deepEqual(createNotebookDraftState({
    note,
    draftTitle: ' Untitled ',
    draftContent: '',
  }), {
    title: 'Untitled',
    content: '',
    isDirty: false,
    canSave: false,
  })

  assert.deepEqual(createNotebookPersistedNote({
    noteId: 'note_1',
    title: '  Saved  ',
    content: '<p>Body</p>',
    fallbackNote: note,
    now: 20,
  }), {
    _id: 'note_1',
    title: 'Saved',
    content: '<p>Body</p>',
    tags: [],
    projectId: undefined,
    createdAt: 10,
    updatedAt: 20,
    shareVisibility: undefined,
    shareToken: undefined,
  })

  assert.deepEqual(createRenamedNotebookNote({
    note,
    title: '  Renamed  ',
    content: '<p>Updated</p>',
    now: 30,
  }), {
    ...note,
    title: 'Renamed',
    content: '<p>Updated</p>',
    updatedAt: 30,
  })
})

test('notebook agent stream helpers parse events and map UI items', () => {
  assert.equal(parseNotebookAgentStreamLine('not-json'), null)
  assert.deepEqual(parseNotebookAgentStreamLine('{"type":"text","text":"Hello"}'), {
    type: 'text',
    text: 'Hello',
  })
  assert.deepEqual(notebookAgentEventToUiItem({ type: 'tool_call', tool: 'search_knowledge' }), {
    type: 'tool_call',
    tool: 'search_knowledge',
    toolInput: undefined,
  })
  assert.equal(notebookAgentEventToUiItem({ type: 'text', text: '  ' }), null)
  assert.equal(notebookAgentEventToUiItem({ type: 'done' }), null)
})

test('markdown normalization preserves html and converts plain markdown', () => {
  assert.equal(normalizeNotebookContent('<p>Already HTML</p>'), '<p>Already HTML</p>')
  assert.equal(normalizeNotebookContent(''), '')
  assert.equal(markdownToNotebookHtml('# Heading\n\n- **Task**'), '<h1>Heading</h1><ul><li><p><strong>Task</strong></p></li></ul>')
  assert.equal(
    normalizeNotebookContent('| A | B |\n| - | :-: |\n| 1 | 2 |'),
    '<table><thead><tr><th>A</th><th style="text-align: center;">B</th></tr></thead><tbody><tr><td>1</td><td style="text-align: center;">2</td></tr></tbody></table>',
  )
})
