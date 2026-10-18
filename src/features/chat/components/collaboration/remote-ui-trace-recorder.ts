import {hashTraceText, sampleRemoteUi} from './remote-ui-trace-dom'
import {appendRemoteUiTrace, openRemoteUiTrace, type RemoteUiTraceRecord} from './remote-ui-trace-store'

export function recordRemoteUiTrace(options: {
  runId: string; messageId: string; candidateSha: string
  root: () => HTMLElement | null; terminal: () => boolean
  onStatus: (status: 'recording' | 'stopped' | 'error') => void
}) {
  const identity = {version: 1, recordingId: crypto.randomUUID(), runId: options.runId, messageId: options.messageId} satisfies
    Pick<RemoteUiTraceRecord, 'version' | 'recordingId' | 'runId' | 'messageId'>
  let sequence = 0, disposed = false, ended = false, timer = 0
  let lastAt: number | undefined, previousText: string | undefined, previousHash = ''
  const database = openRemoteUiTrace()
  const write = async (row: RemoteUiTraceRecord) => appendRemoteUiTrace(await database, row)
  const base = () => ({...identity, sequence: sequence++, at: Date.now()})
  async function sample() {
    const snapshot = sampleRemoteUi(options.root())
    if (snapshot.text.length > 1_000_000) throw new Error('Timing sample limit reached')
    if (previousText !== snapshot.text) {
      previousHash = await hashTraceText(snapshot.text)
      previousText = snapshot.text
    }
    const {text, ...geometry} = snapshot
    await write({...base(), kind: 'sample', ...geometry, units: text.length, sha256: previousHash,
      gapMs: lastAt === undefined ? 0 : snapshot.before - lastAt})
    lastAt = snapshot.before
  }
  async function end(reason: 'unmounted' | 'terminal') {
    if (ended) return
    ended = true
    await write({...base(), kind: 'end', reason})
    ;(await database).close()
    options.onStatus('stopped')
  }
  async function tick() {
    if (disposed) return
    await sample()
    if (options.terminal()) { await end('terminal'); return }
    if (!disposed) timer = window.setTimeout(() => { pending = tick().catch(failed) }, 250)
  }
  function failed() {
    disposed = true
    window.clearTimeout(timer)
    options.onStatus('error')
  }
  let pending = (async () => {
    await write({...base(), kind: 'start', candidateSha: options.candidateSha, timeOrigin: performance.timeOrigin})
    options.onStatus('recording')
    await tick()
  })().catch(failed)
  return () => {
    const wasDisposed = disposed
    disposed = true
    window.clearTimeout(timer)
    void pending.then(async () => {
      if (!wasDisposed) await end('unmounted')
    }).catch(failed).finally(async () => { (await database).close() }).catch(failed)
  }
}
