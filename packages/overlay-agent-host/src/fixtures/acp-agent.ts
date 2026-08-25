import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'

const sessions = new Set<string>()
const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
)

await acp.agent({ name: 'overlay-agent-host-test-fixture' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
  }))
  .onRequest(acp.methods.agent.session.new, () => {
    const sessionId = randomUUID()
    sessions.add(sessionId)
    return { sessionId }
  })
  .onRequest(acp.methods.agent.session.load, ({ params }) => {
    sessions.add(params.sessionId)
    return {}
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    if (!sessions.has(params.sessionId)) throw new Error('unknown session')
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ACP fixture output' } },
    })
    const permission = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: { toolCallId: 'fixture-write', title: 'Write fixture file', status: 'pending' },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call', toolCallId: 'fixture-write', title: 'Write fixture file',
        status: permission.outcome.outcome === 'selected' ? 'completed' : 'failed',
        content: [
          { type: 'diff', path: '/workspace/fixture.txt', oldText: '', newText: 'fixture output\n' },
          { type: 'terminal', terminalId: 'fixture-terminal' },
        ],
      },
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'plan', entries: [{ content: 'Verify the fixture', status: 'completed', priority: 'high' }] },
    })
    await client.request(acp.methods.client.elicitation.create, {
      sessionId: params.sessionId, mode: 'form', message: 'Choose the fixture label',
      requestedSchema: { type: 'object', properties: { label: { type: 'string', title: 'Label' } }, required: ['label'] },
    })
    return { stopReason: 'end_turn' }
  })
  .onNotification(acp.methods.agent.session.cancel, () => undefined)
  .connect(stream).closed
