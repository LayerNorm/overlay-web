import { appendFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'

const choices: acp.SessionConfigOption[] = [
  { type: 'select', id: 'provider-model', category: 'model', name: 'Model', currentValue: 'default',
    options: [{ value: 'default', name: 'Default' }, { value: 'future-model', name: 'Future model' }] },
  { type: 'select', id: 'provider-effort', category: 'thought_level', name: 'Effort', currentValue: 'low',
    options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
  { type: 'select', id: 'permissions', category: 'mode', name: 'Permissions', currentValue: 'default',
    options: [{ value: 'default', name: 'Manual' }, { value: 'auto', name: 'Auto' }] },
]
function record(value: unknown) {
  const path = process.env.FIXTURE_OPTIONS_LOG
  if (path) appendFileSync(path, JSON.stringify(value) + '\n')
}
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>)
await acp.agent({ name: 'options-fixture' })
  .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: true } }))
  .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'options-session', configOptions: choices }))
  .onRequest(acp.methods.agent.session.load, () => ({ configOptions: choices }))
  .onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => {
    const option = choices.find(choice => choice.id === params.configId)
    if (!option || option.type !== 'select' || typeof params.value !== 'string' || !option.options.some(value => 'value' in value && value.value === params.value)) {
      throw new acp.RequestError(-32602, `Fixture agent does not offer ${params.configId}=${params.value}`)
    }
    option.currentValue = params.value
    record({ kind: 'selection', id: params.configId, value: params.value })
    return { configOptions: choices }
  })
  .onRequest(acp.methods.agent.session.prompt, () => {
    record({ kind: 'prompt', values: choices.map(option => ({ id: option.id, value: option.currentValue })) })
    return { stopReason: 'end_turn' }
  })
  .onNotification(acp.methods.agent.session.cancel, () => undefined)
  .connect(stream).closed
