import {writeFileSync} from 'node:fs'
import {createInterface} from 'node:readline'

for await (const line of createInterface({input: process.stdin})) {
  const request = JSON.parse(line)
  if (!('id' in request)) continue
  const reply = result => process.stdout.write(JSON.stringify({jsonrpc: '2.0', id: request.id, result}) + '\n')
  if (request.method === 'initialize') reply({protocolVersion: 1, agentCapabilities: {}})
  else if (request.method === 'session/new') reply({sessionId: 'pending-session'})
  else if (request.method === 'session/prompt') {
    writeFileSync(process.argv[2], String(process.pid))
    process.stdout.write(JSON.stringify({jsonrpc: '2.0', method: 'session/update', params: {
      sessionId: 'pending-session', update: {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'Retain the unfinished answer 🙂\n'}},
    }}) + '\n')
    // The provider remains in flight until its host really terminates it.
  }
}
