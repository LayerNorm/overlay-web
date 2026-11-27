import { PrivateThreadService, privateThreadsDatabasePath } from './private-threads.js'
import { PrivateThreadStore } from './private-threads-store.js'
import {
  PRIVATE_THREADS_PROTOCOL_VERSION,
  type PrivateIpcInbound,
  type PrivateIpcOutbound,
} from './private-threads-protocol.js'

/**
 * `overlay-agent-host private --state-dir <dir>`: serves private threads to the
 * Overlay Desktop process that started it, over Node.js IPC only. It opens no port
 * and exits when its parent goes away.
 */
export async function servePrivateThreads(stateDirectory: string): Promise<void> {
  const send = process.send?.bind(process)
  if (!send) throw new Error('overlay-agent-host private must be started by Overlay Desktop with an IPC channel.')
  const post = (message: PrivateIpcOutbound) => { if (process.connected) send(message) }
  const store = new PrivateThreadStore(privateThreadsDatabasePath(stateDirectory))
  const service = new PrivateThreadService({
    store, stateDirectory, emit: event => post({ type: 'event', event }),
    log: message => process.stderr.write(`${message}\n`),
  })

  process.on('message', (message: PrivateIpcInbound) => {
    if (!message || message.type !== 'request' || typeof message.id !== 'number') return
    service.handle(message.request).then(
      result => post({ type: 'response', id: message.id, ok: true, result }),
      (error: unknown) => post({ type: 'response', id: message.id, ok: false, error: errorMessage(error) }),
    )
  })

  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await service.shutdown()
    store.close()
    process.exit(0)
  }
  process.on('disconnect', () => void close())
  process.once('SIGTERM', () => void close())
  process.once('SIGINT', () => void close())
  post({ type: 'ready', protocolVersion: PRIVATE_THREADS_PROTOCOL_VERSION })
  await new Promise<never>(() => undefined)
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) return 'The request was not valid.'
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000)
}
