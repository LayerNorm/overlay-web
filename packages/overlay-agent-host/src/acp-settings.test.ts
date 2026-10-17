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
