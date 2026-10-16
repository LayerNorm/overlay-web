import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMcpApprovalBridge } from '@layernorm/overlay-agent-bridge-protocol'
import { AcpAgentAdapter } from './acp-adapter.js'
import { AcpxAgentAdapter } from './acpx-adapter.js'
import type { AgentAdapterSession, NormalizedAgentEvent } from './adapter.js'

for (const transport of ['direct', 'acpx']) for (const early of [false, true]) test(`${transport} ${early ? 'buffers an early answer and' : 'answers'} the canonical MCP card once and replays without a duplicate card`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-mcp-bridge-'))
  const callId = 'd3c2acb6-f09a-4ec6-97eb-39fad2eed724'
  const requestKey = `mcp_call:${callId}`
  const token = 'private-fixture-token'
  const proof = await createMcpApprovalBridge(token, { callId, requestKey })
  const env = { FIXTURE_MCP_APPROVAL_SCHEMA: JSON.stringify({ type: 'object', properties: {
    confirm: { type: 'boolean' }, overlay_request: { type: 'string', enum: [proof] },
  }, required: ['confirm'] }) }
  const args = ['--import', import.meta.resolve('tsx'), join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acp-mcp-approval-agent.ts')]
  const adapter = transport === 'direct'
    ? new AcpAgentAdapter({ id: 'fixture', displayName: 'Fixture', command: process.execPath, args, env })
    : new AcpxAgentAdapter({ id: 'fixture', displayName: 'Fixture', agent: 'fixture', stateDirectory: join(directory, 'state'), registryOverrides: { fixture: [process.execPath, ...args] }, env })
  const events: NormalizedAgentEvent[] = []
  let session: AgentAdapterSession | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    session = await adapter.start({ runId: 'bridge-run', workingDirectory: directory, additionalDirectories: [], prompt: '', metadata: { overlayMcp: { token } } }, async event => { events.push(event) })
    if (early) await session.elicit(requestKey, 'accept', { confirm: true })
    const prompt = session.prompt('One canonical approval')
    const deadline = Date.now() + 5000
    for (; !early;) {
      try { await session.elicit(requestKey, 'accept', { confirm: true }); break }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes('not pending') || Date.now() >= deadline) throw error
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
    await Promise.race([prompt, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Duplicate approval did not replay')), 5000) })])
    assert.equal(events.filter(event => event.type === 'elicitation_requested').length, 0)
    assert.ok(events.some(event => event.type === 'text_checkpoint' && event.payload.text.includes('CANONICAL_APPROVAL_AND_REPLAY_OK')))
    assert.equal(events.at(-1)?.type, 'completed')
  } finally {
    if (timeout) clearTimeout(timeout)
    await session?.stop()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
