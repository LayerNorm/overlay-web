import {z} from 'zod'

const finite = z.number().finite()
const rect = z.object({x: finite, y: finite, width: finite, height: finite})
const clip = z.object({left: finite, top: finite, right: finite, bottom: finite, cssVisible: z.boolean()})
const identity = {
  version: z.literal(1), recordingId: z.string().uuid(), runId: z.string().min(1), messageId: z.string().min(1),
  sequence: z.number().int().nonnegative(), at: finite,
}
export const remoteUiTraceRecord = z.discriminatedUnion('kind', [
  z.object({...identity, kind: z.literal('start'), candidateSha: z.string(), timeOrigin: finite}),
  z.object({...identity, kind: z.literal('sample'), before: finite, monotonicMs: finite, gapMs: finite,
    present: z.boolean(), units: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    visibility: z.enum(['visible', 'hidden']), viewport: z.object({width: finite, height: finite}),
    tail: z.object({clip, rects: z.array(rect), visible: z.boolean()}).nullable()}),
  z.object({...identity, kind: z.literal('end'), reason: z.enum(['unmounted', 'terminal'])}),
])
export type RemoteUiTraceRecord = z.infer<typeof remoteUiTraceRecord>
const MAX_ROWS = 120_000
const counter = z.object({total: z.number().int().nonnegative()})

export async function openRemoteUiTrace(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open('overlay-preview-ui-trace', 1)
    request.onupgradeneeded = () => {
      const database = request.result
      const rows = database.createObjectStore('rows', {keyPath: ['recordingId', 'sequence']})
      rows.createIndex('scope', ['runId', 'messageId'])
      database.createObjectStore('limits')
    }
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result) }
    request.onerror = () => reject(new Error('Timing storage unavailable'))
    request.onblocked = () => { blocked = true; reject(new Error('Timing storage blocked')) }
  })
}

export async function appendRemoteUiTrace(database: IDBDatabase, row: RemoteUiTraceRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['rows', 'limits'], 'readwrite')
    const limits = transaction.objectStore('limits'), request = limits.get('count')
    request.onsuccess = () => {
      const parsed = counter.safeParse(request.result ?? {total: 0})
      if (!parsed.success || parsed.data.total >= MAX_ROWS) { transaction.abort(); return }
      transaction.objectStore('rows').add(row)
      limits.put({total: parsed.data.total + 1}, 'count')
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('Timing storage write failed'))
    transaction.onabort = () => reject(new Error('Timing storage full or write interrupted'))
  })
}

export async function readRemoteUiTrace(database: IDBDatabase, runId: string, messageId: string): Promise<RemoteUiTraceRecord[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('rows', 'readonly')
    const request = transaction.objectStore('rows').index('scope').getAll(IDBKeyRange.only([runId, messageId]), MAX_ROWS + 1)
    request.onsuccess = () => {
      const parsed = z.array(remoteUiTraceRecord).max(MAX_ROWS).safeParse(request.result)
      if (!parsed.success) { reject(new Error('Timing trace is invalid')); return }
      resolve(parsed.data.sort((a, b) => a.at - b.at || a.sequence - b.sequence))
    }
    request.onerror = () => reject(new Error('Timing storage read failed'))
    transaction.onabort = () => reject(new Error('Timing storage read interrupted'))
  })
}
