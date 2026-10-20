import assert from 'node:assert/strict'
import test from 'node:test'
import { agentModeNeedsConfirmation, defaultAgentPermissionMode, environmentAgentOptions, orderedAgentModels, resolvedAgentModelChoice } from './agent-options'

test('options are selected from the exact adapter and malformed catalogs fall back', () => {
  const adapter = (id: string, model: string) => ({ id, displayName: id, protocol: 'acp',
    supports: { prompt: true, approval: true, cancel: true, resume: true },
    options: { discoveredAt: 1000, model: { values: [{ id: model, label: model }] } } })
  const capabilities = { adapters: [adapter('claude-code', 'new-claude'), adapter('codex', 'new-codex')] }
  assert.equal(environmentAgentOptions(capabilities, 'codex')?.model?.values[0]?.id, 'new-codex')
  assert.equal(environmentAgentOptions(capabilities, 'another'), undefined)
  assert.equal(environmentAgentOptions({ adapters: [{ ...adapter('codex', 'x'), options: { discoveredAt: 1, model: { values: [] } } }] }, 'codex'), undefined)
})

test('live models put Default first, order known families by quality and retain new vendor order', () => {
  const ids = ['haiku', 'new-b', 'sonnet', 'default', 'opus', 'new-a']
  const result = orderedAgentModels(ids.map(id => ({ id, label: id })))
  assert.deepEqual(result.map(value => value.id), ['default', 'opus', 'sonnet', 'haiku', 'new-b', 'new-a'])
  assert.deepEqual(ids, ['haiku', 'new-b', 'sonnet', 'default', 'opus', 'new-a'])
})

test('a saved combined model uses its live model and effort without adopting discovery defaults', () => {
  const options = {discoveredAt: 1, model: {currentValue: 'other', values: [{id: 'future-model', label: 'Future model'}]},
    effort: {currentValue: 'low', values: [{id: 'medium', label: 'Medium'}, {id: 'high', label: 'High'}]}}
  assert.deepEqual(resolvedAgentModelChoice(options, 'future-model[medium]'), {model: 'future-model', effort: 'medium'})
  assert.deepEqual(resolvedAgentModelChoice(options, 'future-model[medium]', 'high'), {model: 'future-model', effort: 'high'})
  assert.deepEqual(resolvedAgentModelChoice(options, 'absent[medium]'), {model: 'absent[medium]', effort: undefined})
  assert.deepEqual(resolvedAgentModelChoice(options, 'future-model[unsupported]'), {model: 'future-model[unsupported]', effort: undefined})
  assert.deepEqual(resolvedAgentModelChoice(undefined, 'future-model[medium]'), {model: 'future-model[medium]', effort: undefined})
  const exact = {...options, model: {values: [{id: 'future-model[medium]', label: 'Exact vendor id'}]}}
  assert.deepEqual(resolvedAgentModelChoice(exact, 'future-model[medium]'), {model: 'future-model[medium]', effort: undefined})
})

test('permission defaults match the runtime policy without assuming cloud accept-edits', () => {
  const options = { discoveredAt: 1, mode: { currentValue: 'default', values: [
    { id: 'default', label: 'Manual' }, { id: 'acceptEdits', label: 'Accept edits' },
  ] } }
  assert.equal(defaultAgentPermissionMode(options, true), 'default')
  assert.equal(defaultAgentPermissionMode(options, false), 'acceptEdits')
  assert.equal(defaultAgentPermissionMode({ ...options, mode: { ...options.mode,
    values: [...options.mode.values, { id: 'auto', label: 'Auto' }] } }, true), 'auto')
  assert.equal(defaultAgentPermissionMode(undefined, true), '')
  for (const mode of ['bypassPermissions', 'full-access', 'danger-full-access']) assert.equal(agentModeNeedsConfirmation(mode), true)
  for (const mode of ['default', 'auto', 'plan', 'acceptEdits']) assert.equal(agentModeNeedsConfirmation(mode), false)
})
