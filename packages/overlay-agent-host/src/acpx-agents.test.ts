import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACPX_AGENT_DISPLAY_NAMES,
  ACPX_AGENT_NAMES,
  AcpxAgentAdapter,
  acpxAgentNameFor,
} from './acpx-adapter.js'
import { checkOverlayImage } from './image-check.js'

test('Claude Code and Codex are the only built-in acpx agents', () => {
  assert.equal(acpxAgentNameFor('claude-code'), 'claude')
  assert.equal(acpxAgentNameFor('codex'), 'codex')
  assert.deepEqual(Object.keys(ACPX_AGENT_NAMES), ['claude-code', 'codex'])
  assert.deepEqual(ACPX_AGENT_DISPLAY_NAMES, { 'claude-code': 'Claude Code', codex: 'Codex' })
  for (const id of ['opencode', 'cursor', 'hermes']) assert.equal(acpxAgentNameFor(id), undefined)
  assert.equal(acpxAgentNameFor('unknown-agent'), undefined)
})

test('the image check does not require an experimental agent to be installed', () => {
  const checks = checkOverlayImage({
    manifest: { imageVersion: 2, hostVersion: '0', packages: {}, builtAt: '' } as never,
    resolveAgent: (agent) => (agent === 'claude' || agent === 'codex' ? { command: agent } : undefined),
    exists: () => false,
  })
  assert.deepEqual(checks.filter((check) => !check.ok), [])
  assert.deepEqual(checks.filter((check) => check.name.startsWith('agent:')).map((check) => check.name).sort(), ['agent:claude-code', 'agent:codex'])
})

test('an unknown acpx agent cannot be discovered through a product built-in', async () => {
  const missing = new AcpxAgentAdapter({ id: 'custom-acp', displayName: 'Custom ACP', agent: 'custom', stateDirectory: '/tmp/x' })
  await assert.rejects(missing.discover(), /does not know/)
})

test('a name[level] model falls back to the plain name plus a reasoning effort when only names are offered', async () => {
  const { applyRequestedModel } = await import('./acpx-adapter.js')
  const calls: string[] = []
  const handle = {} as never
  const runtime = {
    setModel: async ({ model }: { model: string }) => {
      calls.push(`model:${model}`)
      if (model.includes('[')) throw new Error('did not advertise that model')
    },
    setConfigOption: async ({ key, value }: { key: string; value: string }) => {
      calls.push(`config:${key}=${value}`)
      if (key !== 'reasoning_effort') throw new Error('unsupported')
    },
  }
  await applyRequestedModel(runtime as never, handle, 'gpt-6-luna[high]')
  assert.deepEqual(calls, ['model:gpt-6-luna[high]', 'model:gpt-6-luna', 'config:reasoning_effort=high'])
})

test('a model the agent does not offer still fails, and one without a level is not retried', async () => {
  const { applyRequestedModel } = await import('./acpx-adapter.js')
  const calls: string[] = []
  const runtime = { setModel: async ({ model }: { model: string }) => { calls.push(model); throw new Error('nope') } }
  await assert.rejects(applyRequestedModel(runtime as never, {} as never, 'sonnet'), /nope/)
  assert.deepEqual(calls, ['sonnet'])
  calls.length = 0
  await assert.rejects(applyRequestedModel(runtime as never, {} as never, 'gpt-x[low]'), /nope/)
  assert.deepEqual(calls, ['gpt-x[low]', 'gpt-x'])
})

test('a rejected legacy reasoning effort cannot silently use the default', async () => {
  const { applyRequestedModel } = await import('./acpx-adapter.js')
  const runtime = {
    setModel: async ({ model }: { model: string }) => { if (model.includes('[')) throw Error('plain model required') },
    setConfigOption: async () => { throw Error('provider rejected effort') },
  }
  await assert.rejects(applyRequestedModel(runtime as never, {} as never, 'gpt-x[high]'), /provider rejected effort/)
})
