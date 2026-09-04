import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWorkspaceAgentInput, isAgentEditorValid } from './agent-editor-input'

test('overlay input trims fields and maps tool groups', () => {
  const input = buildWorkspaceAgentInput({
    name: '  Scout  ',
    description: '',
    instructions: '  Find evidence.  ',
    agentType: 'overlay',
    harnessLabel: 'Codex',
    adapterId: 'codex',
    modelId: '  test-model  ',
    avatarColor: '#2563eb',
    enabledToolGroups: new Set(['memory']),
    visibility: 'creator',
    platforms: ['slack'],
  })
  assert.equal(input.name, 'Scout')
  assert.equal(input.description, undefined)
  assert.equal(input.instructions, 'Find evidence.')
  assert.equal(input.harness, 'overlay')
  assert.equal(input.modelId, 'test-model')
  assert.equal(input.visibility, 'creator')
  assert.deepEqual(input.platforms, ['slack'])
  assert.ok(Array.isArray(input.allowedToolIds))
})

test('byo input generates instructions, harness, and model from the adapter', () => {
  const input = buildWorkspaceAgentInput({
    name: 'Local Codex',
    description: 'Works locally',
    instructions: 'ignored for byo',
    agentType: 'byo',
    harnessLabel: 'Codex',
    adapterId: 'codex',
    modelId: 'test-model',
    avatarColor: '#059669',
    enabledToolGroups: new Set(['memory']),
    visibility: 'workspace',
    platforms: ['slack', 'msteams'],
  })
  assert.match(input.instructions, /Codex/)
  assert.equal(input.harness, 'overlay')
  assert.equal(input.modelId, 'byo/codex')
  assert.deepEqual(input.allowedToolIds, [])
  assert.deepEqual(input.platforms, ['slack', 'msteams'])
  assert.equal(input.description, 'Works locally')
})

test('editor validity mirrors the save gate for both agent types', () => {
  const base = {
    name: 'Scout',
    instructions: 'Find evidence.',
    modelId: 'test-model',
    connectedAgentsEnabled: true,
    bindingValid: true,
  }
  assert.equal(isAgentEditorValid({ ...base, agentType: 'overlay' }), true)
  assert.equal(isAgentEditorValid({ ...base, agentType: 'overlay', name: '  ' }), false)
  assert.equal(isAgentEditorValid({ ...base, agentType: 'overlay', instructions: '' }), false)
  assert.equal(isAgentEditorValid({ ...base, agentType: 'overlay', modelId: '' }), false)
  assert.equal(isAgentEditorValid({ ...base, agentType: 'byo' }), true)
  assert.equal(isAgentEditorValid({ ...base, agentType: 'byo', bindingValid: false }), false)
  assert.equal(
    isAgentEditorValid({ ...base, agentType: 'byo', connectedAgentsEnabled: false }),
    false,
  )
})
