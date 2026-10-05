import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACPX_AGENT_DISPLAY_NAMES,
  ACPX_AGENT_LAUNCH_OVERRIDES,
  ACPX_AGENT_NAMES,
  ACPX_SYSTEM_AGENT_NAMES,
  AcpxAgentAdapter,
  acpxAgentNameFor,
} from './acpx-adapter.js'
import { checkOverlayImage } from './image-check.js'

test('Claude Code and Codex are pinned in the image; the experimental agents are system CLIs acpx launches', () => {
  assert.equal(acpxAgentNameFor('claude-code'), 'claude')
  assert.equal(acpxAgentNameFor('codex'), 'codex')
  assert.equal(acpxAgentNameFor('opencode'), 'opencode')
  assert.equal(acpxAgentNameFor('cursor'), 'cursor')
  assert.equal(acpxAgentNameFor('hermes'), 'hermes')
  assert.equal(acpxAgentNameFor('unknown-agent'), undefined)
  for (const id of Object.keys(ACPX_SYSTEM_AGENT_NAMES)) {
    assert.equal(ACPX_AGENT_NAMES[id], undefined, `${id} must not be in the image-checked set`)
    assert.ok(ACPX_AGENT_DISPLAY_NAMES[id], `${id} needs a display name`)
  }
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

test('an agent acpx has no launch for (Hermes) is started through its override, and the others use acpx\'s own', async () => {
  assert.deepEqual(ACPX_AGENT_LAUNCH_OVERRIDES.hermes, ['hermes', 'acp'])
  const hermes = new AcpxAgentAdapter({ id: 'hermes', displayName: 'Hermes', agent: 'hermes', stateDirectory: '/tmp/x', registryOverrides: { hermes: ACPX_AGENT_LAUNCH_OVERRIDES.hermes! } })
  assert.equal((await hermes.discover()).id, 'hermes')
  const opencode = new AcpxAgentAdapter({ id: 'opencode', displayName: 'OpenCode', agent: 'opencode', stateDirectory: '/tmp/x' })
  assert.equal((await opencode.discover()).id, 'opencode')
  const cursor = new AcpxAgentAdapter({ id: 'cursor', displayName: 'Cursor', agent: 'cursor', stateDirectory: '/tmp/x' })
  assert.equal((await cursor.discover()).displayName, 'Cursor')
  const missing = new AcpxAgentAdapter({ id: 'hermes', displayName: 'Hermes', agent: 'hermes', stateDirectory: '/tmp/x' })
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
