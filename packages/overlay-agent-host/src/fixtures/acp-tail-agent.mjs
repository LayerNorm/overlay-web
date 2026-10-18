import { createInterface } from 'node:readline'
const lines = createInterface({ input: process.stdin })
for await (const line of lines) {
  const request = JSON.parse(line)
  if (!('id' in request)) continue
  const response = result => ({ jsonrpc: '2.0', id: request.id, result })
  if (request.method === 'initialize') process.stdout.write(JSON.stringify(response({ protocolVersion: 1, agentCapabilities: {} })) + '\n')
  else if (request.method === 'session/new') process.stdout.write(JSON.stringify(response({ sessionId: 'tail-session' })) + '\n')
  else if (request.method === 'session/prompt') {
    const notifications = Array.from({ length: 200 }, (_, index) => ({ jsonrpc: '2.0', method: 'session/update',
      params: { sessionId: 'tail-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `piece ${index}\n` } } } }))
    notifications.push({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'tail-session', update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'FINAL_NOTIFICATION_TAIL\n' } } } })
    process.stdout.write([...notifications, response({ stopReason: 'end_turn' })].map(value => JSON.stringify(value)).join('\n') + '\n')
  }
}
