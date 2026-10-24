import {createInterface} from 'node:readline'

const title = 'x'.repeat(1998) + '🙂' + '\ncat <<EOF\n' + 'research findings\n'.repeat(400)
for await (const line of createInterface({input: process.stdin})) {
  const request = JSON.parse(line)
  if (!('id' in request)) continue
  const reply = result => ({jsonrpc: '2.0', id: request.id, result})
  const update = value => ({jsonrpc: '2.0', method: 'session/update', params: {sessionId: 'long-action', update: value}})
  if (request.method === 'initialize') process.stdout.write(JSON.stringify(reply({protocolVersion: 1, agentCapabilities: {}})) + '\n')
  else if (request.method === 'session/new') process.stdout.write(JSON.stringify(reply({sessionId: 'long-action'})) + '\n')
  else if (request.method === 'session/prompt') {
    const messages = [
      update({sessionUpdate: 'tool_call', toolCallId: 'research-write', title, status: 'in_progress', content: [{type: 'terminal', terminalId: 'research-terminal'}]}),
      update({sessionUpdate: 'tool_call_update', toolCallId: 'research-write', title, status: 'completed'}),
      update({sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'Complete answer after the long command 🙂\n'}}),
      reply({stopReason: 'end_turn'}),
    ]
    process.stdout.write(messages.map(message => JSON.stringify(message)).join('\n') + '\n')
  }
}
