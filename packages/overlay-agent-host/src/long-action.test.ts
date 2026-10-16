import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {agentHostEventSchema} from '@layernorm/overlay-agent-bridge-protocol'
import {AcpAgentAdapter} from './acp-adapter.js'
import {AcpxAgentAdapter} from './acpx-adapter.js'
import type {NormalizedAgentEvent} from './adapter.js'
import {createRunStream} from './run-stream.js'

for (const protocol of ['acp', 'acpx']) {
  test(`${protocol}: a long shell title cannot fail a turn or its heartbeat`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'overlay-long-action-'))
    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acp-long-action-agent.mjs')
    const adapter = protocol === 'acp'
      ? new AcpAgentAdapter({id: 'long-action', displayName: 'Long action', command: process.execPath, args: [fixture]})
      : new AcpxAgentAdapter({id: 'long-action', displayName: 'Long action', agent: 'fixture', stateDirectory: directory, registryOverrides: {fixture: [process.execPath, fixture]}})
    const events: NormalizedAgentEvent[] = []
    const invalid: string[] = []
    const stream = createRunStream(async event => {
      events.push(event)
      const parsed = agentHostEventSchema.safeParse({...event, protocolVersion: 1, eventId: 'event', environmentId: 'env', runId: 'run', sourceSequence: events.length, occurredAt: Date.now()})
      if (!parsed.success) invalid.push(parsed.error.message)
    }, {streaming: () => true, observe: async () => 'live', onError: error => {throw error}})
    let session: Awaited<ReturnType<typeof adapter.start>> | undefined
    try {
      session = await adapter.start({runId: 'long-action', workingDirectory: directory, additionalDirectories: [], prompt: '', metadata: {}}, async event => {
        await stream.emit(event)
        if (event.type === 'action' && event.payload.status === 'started') await stream.heartbeat()
      })
      await session.prompt('write a research file with a long foreground shell command')
      assert.deepEqual(invalid, [], 'every action, attached terminal and live heartbeat must satisfy the actual wire schema')
      assert.equal(events.at(-1)?.type, 'completed')
      assert.ok(events.some(event => event.type === 'action' && event.payload.status === 'completed'))
      const heartbeat = events.find(event => event.type === 'heartbeat')
      assert.ok(heartbeat?.type === 'heartbeat' && heartbeat.payload.openTools.length === 1)
      for (const event of events) {
        if (event.type !== 'action' && event.type !== 'terminal') continue
        assert.equal(event.payload.title, Buffer.from(event.payload.title).toString('utf8'), 'display title must not split a Unicode code point')
        assert.ok(event.payload.title.endsWith('…'), 'shortened labels disclose their truncation')
      }
      assert.equal(events.filter(event => event.type === 'text_delta').map(event => event.payload.text).join(''), 'Complete answer after the long command 🙂\n')
    } finally {stream.stop(); await session?.stop(); await rm(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100})}
  })
}
