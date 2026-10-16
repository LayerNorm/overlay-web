import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { AcpAgentAdapter, overlayMcpServers } from './acp-adapter'
import type { NormalizedAgentEvent } from './adapter'
import { createRunStream } from './run-stream'

test('official ACP SDK adapter streams supervised updates and bridges approval and elicitation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acp-'))
  const workspace = join(directory, 'workspace')
  await mkdir(workspace)
  const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acp-agent.ts')
  const adapter = new AcpAgentAdapter({
    id: 'fixture-acp', displayName: 'Fixture ACP', command: process.execPath,
    args: ['--import', import.meta.resolve('tsx'), fixture],
  })
  const events: NormalizedAgentEvent[] = []
  let session: Awaited<ReturnType<typeof adapter.start>> | undefined
  try {
    session = await adapter.start({
      runId: 'run-acp', workingDirectory: workspace, additionalDirectories: [],
      prompt: 'test', metadata: {},
    }, async (event) => { events.push(event) })
    const prompt = session.prompt('test ACP')
    await waitFor(() => events.some((event) => event.type === 'approval_requested'))
    await session.approve('fixture-write', 'allow_once')
    await waitFor(() => events.some((event) => event.type === 'elicitation_requested'))
    const elicitation = events.find((event) => event.type === 'elicitation_requested')
    assert.ok(elicitation?.payload.requestKey)
    await session.elicit(String(elicitation.payload.requestKey), 'accept', { label: 'approved fixture' })
    await prompt
    const tailIndex = events.findIndex(event => event.type === 'text_checkpoint' && event.payload.text.endsWith('FINAL_NOTIFICATION_TAIL\n'))
    assert.ok(tailIndex >= 0, 'final notification must be consumed before prompt completion')
    assert.ok(tailIndex < events.findIndex(event => event.type === 'completed'), 'terminal must follow the final notification')
    assert.ok(events.some((event) => event.type === 'text_checkpoint' && event.payload.text === 'ACP fixture output'))
    assert.ok(events.some((event) => event.type === 'action' && event.payload.status === 'completed'))
    assert.ok(events.some((event) => event.type === 'plan'))
    assert.ok(events.some((event) => event.type === 'diff'))
    assert.ok(events.some((event) => event.type === 'terminal'))
    assert.ok(events.some((event) => event.type === 'completed'))
    const commands = events.find((event) => event.type === 'commands_update')
    assert.deepEqual(commands?.payload.commands, [
      { name: 'fixture-compact', description: 'Compact the fixture session', inputHint: 'instructions' },
      { name: 'fixture-review', description: 'Review the fixture workspace' },
    ])
  } finally {
    await session?.stop()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('ACP adapter discovery enforces its readiness verifier', async () => {
  let checks = 0
  const ready = new AcpAgentAdapter({
    id: 'ready', displayName: 'Ready', command: process.execPath,
    verify: async () => { checks += 1 },
  })
  assert.equal((await ready.discover()).id, 'ready')
  assert.equal(checks, 1)

  const unavailable = new AcpAgentAdapter({
    id: 'unavailable', displayName: 'Unavailable', command: process.execPath,
    verify: async () => { throw new Error('adapter is not ready') },
  })
  await assert.rejects(unavailable.discover(), /adapter is not ready/)
})

test('a buffered wire response cannot overtake the final text notification in either streaming mode', async () => {
  for (const streaming of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), 'overlay-acp-tail-'))
    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acp-tail-agent.mjs')
    const adapter = new AcpAgentAdapter({ id: 'tail-fixture', displayName: 'Tail fixture', command: process.execPath, args: [fixture] })
    const events: NormalizedAgentEvent[] = []
    const stream = createRunStream(async event => { events.push(event) }, { streaming: () => streaming, observe: async () => 'live', onError: error => { throw error } })
    let session: Awaited<ReturnType<typeof adapter.start>> | undefined
    try {
      session = await adapter.start({ runId: 'tail-run', workingDirectory: directory, additionalDirectories: [], prompt: '', metadata: {} }, stream.emit)
      await session.prompt('buffered response')
      const tail = events.filter(event => event.type === 'text_checkpoint' || event.type === 'text_delta').at(-1)
      assert.ok(tail?.payload.text.endsWith('FINAL_NOTIFICATION_TAIL\n'), 'tail must reach the durable stream before completion')
      assert.equal(events.at(-1)?.type, 'completed')
    } finally { stream.stop(); await session?.stop(); await rm(directory, { recursive: true, force: true }) }
  }
})

test('direct ACP applies live model, effort and permission choices before every prompt and reports vendor rejection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acp-options-'))
  const log = join(directory, 'choices.jsonl')
  const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acp-options-agent.ts')
  const adapter = new AcpAgentAdapter({ id: 'options-fixture', displayName: 'Options fixture', command: process.execPath,
    args: ['--import', import.meta.resolve('tsx'), fixture] })
  let session: Awaited<ReturnType<typeof adapter.start>> | undefined
  try {
    session = await adapter.start({ runId: 'options-run', workingDirectory: directory, additionalDirectories: [], prompt: '',
      metadata: { model: 'future-model', effort: 'high', permissionMode: 'auto' }, credentials: { FIXTURE_OPTIONS_LOG: log } }, async () => {})
    assert.equal(adapter.capability.options?.model?.values[1]?.label, 'Future model')
    await session.prompt('first')
    await session.prompt('second')
    const records = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(records.slice(0, 3).map(record => [record.id, record.value]),
      [['provider-model', 'future-model'], ['provider-effort', 'high'], ['permissions', 'auto']])
    assert.equal(records[3].kind, 'prompt')
    assert.deepEqual(records.slice(4, 7).map(record => record.kind), ['selection', 'selection', 'selection'])
    assert.equal(records[7].kind, 'prompt')
    await session.stop()
    session = await adapter.start({ runId: 'invalid-options-run', workingDirectory: directory, additionalDirectories: [], prompt: '',
      metadata: { model: 'not-offered' }, credentials: { FIXTURE_OPTIONS_LOG: log } }, async () => {})
    await assert.rejects(session.prompt('must not dispatch'), /Fixture agent does not offer/)
    assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 8)
  } finally {
    await session?.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

test('discovery reads options without a prompt and cleans its granted-root scratch directory, including timeout fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acp-discovery-'))
  const log = join(directory, 'must-not-prompt.jsonl')
  const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acp-options-agent.ts')
  try {
    const adapter = new AcpAgentAdapter({ id: 'discovery-fixture', displayName: 'Discovery fixture', command: process.execPath,
      args: ['--import', import.meta.resolve('tsx'), fixture] })
    const capability = await adapter.discover({ workingDirectory: directory, credentials: { FIXTURE_OPTIONS_LOG: log } })
    assert.equal(capability.options?.model?.values[1]?.id, 'future-model')
    assert.deepEqual(await readdir(directory), [])
    assert.equal((await adapter.discover({ workingDirectory: directory })).options?.discoveredAt, capability.options?.discoveredAt)
    const hung = new AcpAgentAdapter({ id: 'hung', displayName: 'Hung fixture', command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 10000)'], startupTimeoutMs: 50 })
    assert.equal((await hung.discover({ workingDirectory: directory })).options, undefined)
    assert.deepEqual(await readdir(directory), [])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for ACP event')
}

test('the Overlay MCP server is offered only to HTTP-capable agents over a safe URL', () => {
  const metadata = { overlayMcp: { url: 'https://www.getoverlay.io/api/agent-mcp', token: 'ovmcp_abc.def' } }
  assert.deepEqual(overlayMcpServers(metadata, true), [{
    type: 'http',
    name: 'overlay',
    url: 'https://www.getoverlay.io/api/agent-mcp',
    headers: [{ name: 'Authorization', value: 'Bearer ovmcp_abc.def' }],
  }])
  assert.deepEqual(overlayMcpServers(metadata, false), [])
  assert.deepEqual(overlayMcpServers({}, true), [])
  assert.deepEqual(overlayMcpServers({ overlayMcp: { url: 'http://evil.example/mcp', token: 't' } }, true), [])
  assert.equal(overlayMcpServers({ overlayMcp: { url: 'http://localhost:3000/api/agent-mcp', token: 't' } }, true).length, 1)
})
