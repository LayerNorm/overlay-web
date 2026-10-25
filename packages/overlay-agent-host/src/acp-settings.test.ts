import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAgentSettings, type AgentSettingControls } from './acp-settings.js'

test('legacy composite model ids split into advertised model and effort', async () => {
  const calls: string[] = []
  const controls: AgentSettingControls = {
    async setConfig(id, value) { calls.push(`${id}=${value}`); return {} },
    async setModel(value) { calls.push(`model=${value}`) },
    async setMode(value) { calls.push(`mode=${value}`) },
  }
  await applyAgentSettings(controls, { model: 'gpt-new[high]', permissionContext: 'local' }, {
    discoveredAt: 1000,
    model: { configId: 'model', values: [{ id: 'gpt-new', label: 'New model' }] },
    effort: { configId: 'effort', values: [{ id: 'high', label: 'High' }] },
    mode: { values: [{ id: 'auto', label: 'Auto' }] },
  })
  assert.deepEqual(calls, ['model=gpt-new', 'effort=high'])
})

test('permission defaults only select the appropriate advertised mode', async () => {
  const calls: string[] = []
  const controls: AgentSettingControls = { async setConfig() { return {} }, async setModel() {}, async setMode(value) { calls.push(value) } }
  const options = { discoveredAt: 1000, mode: { values: [{ id: 'acceptEdits', label: 'Edits' }, { id: 'auto', label: 'Auto' }] } }
  await applyAgentSettings(controls, { permissionContext: 'local' }, options)
  await applyAgentSettings(controls, { permissionContext: 'cloud' }, options)
  await applyAgentSettings(controls, { permissionContext: 'cloud', permissionMode: 'acceptEdits' }, options)
  assert.deepEqual(calls, ['acceptEdits', 'auto', 'acceptEdits'])
})

test('model changes refresh the effort config before applying the saved settings', async () => {
  const calls: string[] = []
  await applyAgentSettings({
    async setConfig(id, value) {
      calls.push(`${id}=${value}`)
      return id === 'model' ? { configOptions: [{ id: 'new-effort', name: 'Effort', category: 'thought_level',
        type: 'select', currentValue: 'low', options: [{ value: 'high', name: 'High' }] }] } : {}
    },
    async setModel() { assert.fail('Expected model config') },
    async setMode(value) { calls.push(`mode=${value}`) },
  }, { model: 'sonnet', effort: 'high', permissionMode: 'plan' }, {
    discoveredAt: 1, model: { configId: 'model', values: [{ id: 'sonnet', label: 'Sonnet 5.5' }] },
  })
  assert.deepEqual(calls, ['model=sonnet', 'new-effort=high', 'mode=plan'])
})

test('vendor rejection stops settings application rather than falling back silently', async () => {
  await assert.rejects(applyAgentSettings({
    async setConfig() { throw new Error('Effort unavailable for this model') },
    async setModel() {},
    async setMode() { assert.fail('Must stop before changing mode') },
  }, { effort: 'ultra', permissionMode: 'auto' }, { discoveredAt: 1 }), /Effort unavailable/)
})
