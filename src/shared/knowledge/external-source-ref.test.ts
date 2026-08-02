import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildConnectedKnowledgeSourceRef,
  parseConnectedKnowledgeSourceRef,
} from './external-source-ref'

test('connected knowledge references round-trip opaque provider identifiers', () => {
  const ref = buildConnectedKnowledgeSourceRef({
    recipe: 'google-drive-file',
    resourceId: 'folder/file id:revision',
  })
  assert.deepEqual(parseConnectedKnowledgeSourceRef(ref), {
    recipe: 'google-drive-file',
    resourceId: 'folder/file id:revision',
  })
})

test('connected knowledge references reject unknown recipes and empty identifiers', () => {
  assert.equal(parseConnectedKnowledgeSourceRef('overlay-source:v1:write-tool:item'), null)
  assert.equal(parseConnectedKnowledgeSourceRef('overlay-source:v1:notion-page:'), null)
  assert.throws(() => buildConnectedKnowledgeSourceRef({
    recipe: 'notion-page',
    resourceId: ' ',
  }))
})
