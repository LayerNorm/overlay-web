import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveRetrievalScope } from './retrieval-scope'

test('with no mention the project and conversation bases apply', () => {
  const scope = resolveRetrievalScope({
    projectKnowledgeBaseIds: ['kb-handbook', 'kb-policies'],
    conversationKnowledgeBaseIds: ['kb-chat'],
  })
  assert.equal(scope.mode, 'project')
  assert.deepEqual(scope.knowledgeBaseIds, ['kb-chat', 'kb-handbook', 'kb-policies'])
  assert.equal(scope.narrowedByMention, false)
})

test('an explicit mention narrows scope to only the mentioned base', () => {
  const scope = resolveRetrievalScope({
    projectKnowledgeBaseIds: ['kb-handbook', 'kb-policies'],
    mentionedKnowledgeBaseIds: ['kb-handbook'],
  })
  assert.equal(scope.mode, 'selected')
  assert.deepEqual(scope.knowledgeBaseIds, ['kb-handbook'])
  assert.equal(scope.narrowedByMention, true)
})

test('mentioning a base outside the project still narrows to it', () => {
  const scope = resolveRetrievalScope({
    projectKnowledgeBaseIds: ['kb-handbook'],
    mentionedKnowledgeBaseIds: ['kb-unrelated'],
  })
  assert.deepEqual(scope.knowledgeBaseIds, ['kb-unrelated'])
})

test('combined mode unions mentioned, conversation and project bases', () => {
  const scope = resolveRetrievalScope({
    projectKnowledgeBaseIds: ['kb-project'],
    conversationKnowledgeBaseIds: ['kb-chat'],
    mentionedKnowledgeBaseIds: ['kb-mentioned'],
    mode: 'combined',
  })
  assert.deepEqual(scope.knowledgeBaseIds, ['kb-mentioned', 'kb-chat', 'kb-project'])
})

test('selected mode with nothing mentioned falls back to attached bases', () => {
  const scope = resolveRetrievalScope({
    projectKnowledgeBaseIds: ['kb-project'],
    mode: 'selected',
  })
  assert.deepEqual(scope.knowledgeBaseIds, ['kb-project'])
  assert.equal(scope.narrowedByMention, false)
})

test('no attachments anywhere yields an empty scope', () => {
  assert.deepEqual(resolveRetrievalScope({}).knowledgeBaseIds, [])
})

test('group defaults apply only when the turn has no explicit or attached scope', () => {
  assert.deepEqual(resolveRetrievalScope({
    defaultKnowledgeBaseIds: ['kb-default'],
  }).knowledgeBaseIds, ['kb-default'])

  assert.deepEqual(resolveRetrievalScope({
    defaultKnowledgeBaseIds: ['kb-default'],
    projectKnowledgeBaseIds: ['kb-project'],
  }).knowledgeBaseIds, ['kb-project'])

  assert.deepEqual(resolveRetrievalScope({
    defaultKnowledgeBaseIds: ['kb-default'],
    mentionedKnowledgeBaseIds: ['kb-mentioned'],
  }).knowledgeBaseIds, ['kb-mentioned'])
})

test('combined mode does not widen attached context with group defaults', () => {
  const scope = resolveRetrievalScope({
    defaultKnowledgeBaseIds: ['kb-default'],
    projectKnowledgeBaseIds: ['kb-project'],
    mentionedKnowledgeBaseIds: ['kb-mentioned'],
    mode: 'combined',
  })
  assert.deepEqual(scope.knowledgeBaseIds, ['kb-mentioned', 'kb-project'])
})

test('blank and duplicate ids are discarded', () => {
  const scope = resolveRetrievalScope({
    projectKnowledgeBaseIds: [' kb-a ', 'kb-a', '', '   ', 'kb-b'],
  })
  assert.deepEqual(scope.knowledgeBaseIds, ['kb-a', 'kb-b'])
})

test('scope is capped at the per-turn base limit', () => {
  const scope = resolveRetrievalScope({
    projectKnowledgeBaseIds: Array.from({ length: 20 }, (_value, index) => `kb-${index}`),
  })
  assert.equal(scope.knowledgeBaseIds.length, 8)
})
