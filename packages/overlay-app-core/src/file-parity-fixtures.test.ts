import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FILE_PARITY_EDITOR_SCENARIOS,
  FILE_PARITY_FILES,
  FILE_PARITY_LIST_SCENARIOS,
  FILE_PARITY_VIEWER_SCENARIOS,
  createFileParityInstrumentation,
} from './file-parity-fixtures'

test('file parity fixtures cover the required file, state, and interaction matrix', () => {
  const listIds = new Set(FILE_PARITY_LIST_SCENARIOS.map((scenario) => scenario.id))
  for (const id of [
    'empty', 'loading', 'refreshing', 'error', 'inventory', 'search', 'selected-row',
    'bulk-selection', 'context-menu', 'offline', 'syncing', 'conflicted', 'migration',
  ]) assert.ok(listIds.has(id), `missing list fixture ${id}`)

  const kinds = new Set(FILE_PARITY_VIEWER_SCENARIOS.map((scenario) => scenario.kind))
  for (const kind of ['markdown', 'text', 'csv', 'html', 'pdf', 'docx', 'image', 'audio', 'video', 'missing-preview']) {
    assert.ok(kinds.has(kind as never), `missing viewer fixture ${kind}`)
  }

  assert.ok(FILE_PARITY_FILES.some((file) => file.type === 'folder' && file.parentId))
  assert.ok(FILE_PARITY_FILES.some((file) => file.kind === 'note' && !file.previewText))
  assert.ok(FILE_PARITY_FILES.some((file) => file.kind === 'output'))
  assert.deepEqual(FILE_PARITY_EDITOR_SCENARIOS.map((scenario) => scenario.state), [
    'ready', 'hydrating', 'saving', 'conflicted', 'migration',
  ])
})

test('file parity instrumentation exposes isolated deterministic counters', () => {
  const instrumentation = createFileParityInstrumentation()
  instrumentation.recordFetch()
  instrumentation.recordMount('FileSurface')
  instrumentation.recordRender('FileSurface')
  instrumentation.recordEditorHydration()
  instrumentation.recordEditorSave('queued')
  instrumentation.recordEditorSave('committed')

  assert.deepEqual(instrumentation.snapshot(), {
    fetches: 1,
    mounts: { FileSurface: 1 },
    renders: { FileSurface: 1 },
    editorHydrations: 1,
    editorSaveQueued: 1,
    editorSaveCommitted: 1,
  })
})
