import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentHostCommand, EventBatch } from '@layernorm/overlay-agent-bridge-protocol'
import type { AgentAdapter } from './adapter'
import { AgentHostRuntime } from './runtime'
import { SqliteHostStateStore } from './state'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-durable-'))
  const root = join(directory, 'project'); await mkdir(root)
  let starts = 0
  const events: EventBatch[] = []
  const capabilities: Array<Record<string, unknown>> = []
  const adapter: AgentAdapter = {
    capability: { id: 'fixture', displayName: 'Fixture', protocol: 'fake', supports: { prompt: true, approval: true, cancel: true, resume: true },
      recovery: { liveReattachment: true, sessionLoading: true, interruptedTurnContinuation: false, approvalRestoration: false, providerCheckpoints: false } },
    async discover() { return this.capability },
    async start() { starts++; return { remoteSessionId: 'native', async prompt() {}, async approve() {}, async elicit() {}, async cancel() {}, async resume() {}, async stop() {}, async observe() { return 'live' } } },
  }
  const state = new SqliteHostStateStore(join(directory, 'host.sqlite'))
  const controlPlane = { async pollCommands() { return { commands: [] } }, async acknowledgeCommand() {},
    async updateCapabilities(input: Record<string, unknown>) { capabilities.push(input) },
    async uploadEvents(batch: EventBatch) { events.push(batch); return { protocolVersion: 1 as const, accepted: true as const, acknowledgedSequence: batch.events.at(-1)!.sourceSequence } } }
  const create = (durableLifecycle = true) => new AgentHostRuntime({ durableLifecycle, environmentId: 'env', workspaceId: 'ws', filesystem: { mode: 'selected_roots', roots: [root] }, state, adapters: [adapter], controlPlane })
  const command = (sequence: number, type: AgentHostCommand['type'], payload: Record<string, unknown>): AgentHostCommand => ({
    protocolVersion: 1, commandId: `command-${sequence}`, environmentId: 'env', workspaceId: 'ws', runId: 'run', issuedAt: 1, sequence,
    execution: { attemptId: 'attempt', generation: 1 }, type, payload,
  } as AgentHostCommand)
  const start = command(1, 'start', { bindingId: 'binding', adapterId: 'fixture', workingDirectory: root, prompt: 'do one write',
    metadata: { model: 'chosen-model', overlayMcp: { token: 'must-not-be-checkpointed', url: 'https://example.test/mcp' } } })
  return { state, events, capabilities, create, command, start, starts: () => starts,
    async cleanup() { state.close(); await rm(directory, { recursive: true, force: true }) } }
}

test('live reconnect keeps one process/attempt and checkpoints only nonsecret configuration', async () => {
  const f = await fixture()
  try {
    const runtime = f.create()
    await runtime.processCommand(f.start)
    await runtime.processCommand(f.command(2, 'reconnect', { remoteSessionId: 'native' }))
    assert.equal(f.starts(), 1)
    assert.equal(f.events.flatMap(b => b.events).at(-1)?.type, 'process_observation')
    assert.equal(f.state.getSession('run')?.config?.model, 'chosen-model')
    assert.ok(!JSON.stringify(f.state.getSession('run')).includes('must-not-be-checkpointed'))
    assert.equal(f.events[0].events[0].execution?.attemptId, 'attempt')
  } finally { await f.cleanup() }
})

test('bridge restart with an unknown orphan refuses continuation and does not create a second writer', async () => {
  const f = await fixture()
  try {
    await f.create().processCommand(f.start)
    const restarted = f.create()
    await assert.rejects(restarted.processCommand(f.command(2, 'reconnect', { remoteSessionId: 'native' })), /cannot restore interrupted/)
    assert.equal(f.starts(), 1)
    const observation = f.events.flatMap(b => b.events).find(e => e.type === 'process_observation')
    assert.equal(observation?.payload.process, 'unknown')
    assert.equal(observation?.payload.recoveryOutcome, 'unavailable')
  } finally { await f.cleanup() }
})

test('a crash after durable start claim cannot replay an uncertain external action', async () => {
  const f = await fixture()
  try {
    assert.equal(f.state.claimExecution('run', 'attempt'), true)
    await assert.rejects(f.create().processCommand(f.start), /start outcome is unknown/)
    assert.equal(f.starts(), 0)
  } finally { await f.cleanup() }
})

test('unnegotiated execution fields are refused before process creation', async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.create(false).processCommand(f.start), /not negotiated/)
    assert.equal(f.starts(), 0)
  } finally { await f.cleanup() }
})

test('attempt outboxes have separate cursors and acknowledgement never deletes another attempt', async () => {
  const f = await fixture()
  try {
    for (const attemptId of ['old', 'current']) f.state.appendEvent({ protocolVersion: 1, eventId: `event-${attemptId}`,
      environmentId: 'env', runId: 'run', execution: { attemptId, generation: attemptId === 'old' ? 1 : 2 }, occurredAt: 1,
      type: 'text_checkpoint', payload: { text: attemptId } })
    assert.equal(f.state.pendingEvents(100)[0]?.sourceSequence, 1)
    f.state.acknowledgeEvents('run', 1, 'old')
    assert.equal(f.state.outboxSize(), 1)
    assert.equal(f.state.pendingEvents(100)[0]?.execution?.attemptId, 'current')
    assert.equal(f.state.pendingEvents(100)[0]?.sourceSequence, 1)
  } finally { await f.cleanup() }
})
