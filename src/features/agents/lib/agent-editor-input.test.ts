import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspaceAgentInput,
  isAgentEditorValid,
  isDefaultMasterAgent,
  workspaceAgentReasoningForSave,
} from './agent-editor-input'

test('agent reasoning save uses advertised levels and clears unsupported persisted values', () => {
  const reasoningModels = [
    { id: 'model-a', reasoningLevels: [{ value: 'provider-default' as const }, { value: 'low' as const }] },
    { id: 'model-b', reasoningLevels: [{ value: 'provider-default' as const }, { value: 'high' as const }] },
  ]
  assert.equal(workspaceAgentReasoningForSave({
    modelId: 'model-a',
    reasoning: 'high',
    reasoningModels,
    existingModelId: 'model-a',
    existingReasoning: 'high',
  }), 'provider-default')
  assert.equal(workspaceAgentReasoningForSave({
    modelId: 'model-b',
    reasoning: 'high',
    reasoningModels,
  }), 'high')
  assert.equal(workspaceAgentReasoningForSave({
    modelId: 'model-a',
    reasoning: 'high',
    reasoningModels,
  }), undefined)
})

test('chief protection follows explicit role or legacy flag, never display name', () => {
  assert.equal(isDefaultMasterAgent({ name: 'Overlay' }), false)
  assert.equal(isDefaultMasterAgent({ name: 'Atlas', agentRole: 'personal_chief' }), true)
  assert.equal(isDefaultMasterAgent({ name: 'Team', agentRole: 'workspace_chief' }), true)
  assert.equal(isDefaultMasterAgent({ name: 'Renamed legacy', isDefault: true }), true)
})

test('overlay input trims fields and maps tool groups', () => {
  const input = buildWorkspaceAgentInput({
    name: '  Scout  ',
    description: '',
    instructions: '  Find evidence.  ',
    agentType: 'overlay',
    harnessLabel: 'Codex',
    adapterId: 'codex',
    modelId: '  test-model  ',
    reasoning: 'high',
    avatarColor: '#2563eb',
    avatarShape: 'droplet',
    enabledToolGroups: new Set(['memory']),
    visibility: 'creator',
  })
  assert.equal(input.name, 'Scout')
  assert.equal(input.description, '')
  assert.equal(input.instructions, 'Find evidence.')
  assert.equal(input.harness, 'overlay')
  assert.equal(input.modelId, 'test-model')
  assert.equal(input.reasoning, 'high')
  assert.equal(input.visibility, 'creator')
  assert.equal(input.avatarShape, 'droplet')
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
    reasoning: 'high',
    avatarColor: '#059669',
    avatarShape: 'cloud',
    enabledToolGroups: new Set(['memory']),
    visibility: 'workspace',
  })
  assert.match(input.instructions, /Codex/)
  assert.equal(input.harness, 'overlay')
  assert.equal(input.modelId, 'byo/codex')
  assert.equal(input.reasoning, undefined)
  assert.deepEqual(input.allowedToolIds, [])
  assert.equal(input.description, 'Works locally')
})

test('editor validity mirrors the save gate for both agent shapes', () => {
  const base = {
    name: 'Scout',
    instructions: 'Find evidence.',
    modelId: 'test-model',
    legacyHostedRuntime: false,
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
  // An agent whose hosted runtime was removed is read-only.
  assert.equal(isAgentEditorValid({ ...base, agentType: 'overlay', legacyHostedRuntime: true }), false)
})
