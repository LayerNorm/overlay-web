import {createInterface} from 'node:readline'

function response(id, result) { return {jsonrpc: '2.0', id, result} }
function update(sessionId, value) {
  return {jsonrpc: '2.0', method: 'session/update', params: {sessionId, update: value}}
}
function send(messages) { process.stdout.write(messages.map(message => JSON.stringify(message) + '\n').join('')) }

createInterface({input: process.stdin}).on('line', line => {
  const request = JSON.parse(line)
  if (request.method === 'initialize') send([response(request.id, {protocolVersion: 1, agentCapabilities: {loadSession: true}})])
  else if (request.method === 'session/load') send([
    update(request.params.sessionId, {sessionUpdate: 'available_commands_update', availableCommands: [{name: 'continue-check', description: 'Inspect the loaded session'}]}),
    update(request.params.sessionId, {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'OLD_HISTORY'}}),
    update(request.params.sessionId, {sessionUpdate: 'tool_call', toolCallId: 'old-call', title: 'Historical action', status: 'completed'}),
    response(request.id, {}),
    update(request.params.sessionId, {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'LATE_LOAD_HISTORY'}}),
    update(request.params.sessionId, {sessionUpdate: 'available_commands_update', availableCommands: [{name: 'continue-loaded', description: 'Loading history finished'}]}),
  ])
  else if (request.method === 'session/prompt') send([
    update(request.params.sessionId, {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'NEW_OUTPUT'}}),
    response(request.id, {stopReason: 'end_turn'}),
  ])
})
