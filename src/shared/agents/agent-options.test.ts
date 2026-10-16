import assert from 'node:assert/strict'
import test from 'node:test'
import { environmentAgentOptions, orderedAgentModels } from './agent-options'

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
