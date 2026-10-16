import {appendFileSync, existsSync} from 'node:fs'
import {createInterface} from 'node:readline'

const log = process.env.FIXTURE_OPTIONS_LOG, gate = process.env.FIXTURE_DISCOVERY_GATE
if (!log || !gate) throw Error('The discovery fixture requires its observation log and release gate')
const choices = [{type: 'select', id: 'provider-model', category: 'model', name: 'Model', currentValue: 'default',
  options: [{value: 'default', name: 'Default'}, {value: 'future-model', name: 'Future model'}]}]
function respond(id, result) {process.stdout.write(JSON.stringify({jsonrpc: '2.0', id, result}) + '\n')}

for await (const line of createInterface({input: process.stdin})) {
  const request = JSON.parse(line)
  if (request.method === 'initialize') respond(request.id, {protocolVersion: 1, agentCapabilities: {loadSession: true}})
  else if (request.method === 'session/new') {
    appendFileSync(log, JSON.stringify({kind: 'discovery', cwd: request.params.cwd}) + '\n')
    while (!existsSync(gate)) await new Promise(resolve => setTimeout(resolve, 10))
    respond(request.id, {sessionId: 'discovery-session', configOptions: choices})
  } else if (request.method === 'session/prompt') {
    appendFileSync(log, JSON.stringify({kind: 'unexpected-prompt'}) + '\n')
    respond(request.id, {stopReason: 'end_turn'})
  } else if (request.id !== undefined) respond(request.id, {})
}
