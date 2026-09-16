import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWorkspaceAgentInput, isAgentEditorValid } from './agent-editor-input'

test('overlay input trims fields and maps tool groups', () => {
  const input = buildWorkspaceAgentInput({
    name: '  Scout  ',
    description: '',
    instructions: '  Find evidence.  ',
    agentType: 'overlay',
    hostedRuntime: 'overlay',
    harnessBillingModelId: '',
    harnessLabel: 'Codex',
    adapterId: 'codex',
    modelId: '  test-model  ',
    avatarColor: '#2563eb',
    avatarShape: 'droplet',
    enabledToolGroups: new Set(['memory']),
    visibility: 'creator',
  })
  assert.equal(input.name, 'Scout')
  assert.equal(input.description, undefined)
  assert.equal(input.instructions, 'Find evidence.')
  assert.equal(input.harness, 'overlay')
  assert.equal(input.modelId, 'test-model')
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
    hostedRuntime: 'overlay',
    harnessBillingModelId: '',
    harnessLabel: 'Codex',
    adapterId: 'codex',
    modelId: 'test-model',
    avatarColor: '#059669',
    avatarShape: 'cloud',
    enabledToolGroups: new Set(['memory']),
    visibility: 'workspace',
  })
  assert.match(input.instructions, /Codex/)
  assert.equal(input.harness, 'overlay')
  assert.equal(input.modelId, 'byo/codex')
  assert.deepEqual(input.allowedToolIds, [])
  assert.equal(input.description, 'Works locally')
})

test('managed harness input stores the priced model id, harness id, and no tool grants', () => {
  const input = buildWorkspaceAgentInput({
    name: 'Cloud Claude',
    description: '',
    instructions: '  Review pull requests.  ',
    agentType: 'overlay',
    hostedRuntime: 'claude-code',
    harnessBillingModelId: 'claude-sonnet-4-6',
    harnessLabel: 'Claude Code',
    adapterId: '',
    modelId: 'ignored-for-managed',
    avatarColor: '#2563eb',
    avatarShape: 'circle',
    enabledToolGroups: new Set(['memory']),
    visibility: 'workspace',
  })
  assert.equal(input.harness, 'claude-code')
  assert.equal(input.modelId, 'claude-sonnet-4-6')
  assert.equal(input.instructions, 'Review pull requests.')
  assert.deepEqual(input.allowedToolIds, [])
})

test('editor validity mirrors the save gate for all three agent shapes', () => {
  const base = {
    name: 'Scout',
    instructions: 'Find evidence.',
    modelId: 'test-model',
    hostedRuntime: 'overlay',
    harnessBillingModelId: '',
    managedHarnessEnabled: true,
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
  // Managed harness branch: needs the picker up, instructions, and a priced
  // billing model — the hosted modelId field is irrelevant there.
  const managed = { ...base, agentType: 'overlay' as const, hostedRuntime: 'claude-code', harnessBillingModelId: 'claude-sonnet-4-6' }
  assert.equal(isAgentEditorValid(managed), true)
  assert.equal(isAgentEditorValid({ ...managed, managedHarnessEnabled: false }), false)
  assert.equal(isAgentEditorValid({ ...managed, harnessBillingModelId: '' }), false)
  assert.equal(isAgentEditorValid({ ...managed, instructions: '' }), false)
})
