import * as acp from '@agentclientprotocol/sdk'

const schema = JSON.parse(process.env.FIXTURE_MCP_APPROVAL_SCHEMA ?? '{}')
const stream = acp.ndJsonStream(new WritableStream<Uint8Array>({
  write: chunk => new Promise<void>((resolve, reject) => { process.stdout.write(chunk, error => error ? reject(error) : resolve()) }),
}), new ReadableStream<Uint8Array>({ start(controller) {
  process.stdin.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
  process.stdin.on('end', () => controller.close())
  process.stdin.on('error', error => controller.error(error))
} }))
await acp.agent({ name: 'mcp-approval-bridge-fixture' })
  .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} }))
  .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'bridge-fixture-session' }))
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    // The second request simulates redelivery after the original approval response was lost.
    for (let index = 0; index < 2; index++) {
      const response = await client.request(acp.methods.client.elicitation.create, {
        sessionId: params.sessionId, mode: 'form', message: 'Canonical Overlay approval', requestedSchema: schema,
      })
      if (response.action !== 'accept' || !response.content || typeof response.content !== 'object' || !('confirm' in response.content) || response.content.confirm !== true) throw Error('Fixture approval was refused')
    }
    await client.notify(acp.methods.client.session.update, { sessionId: params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'CANONICAL_APPROVAL_AND_REPLAY_OK' } } })
    return { stopReason: 'end_turn' }
  }).connect(stream).closed
