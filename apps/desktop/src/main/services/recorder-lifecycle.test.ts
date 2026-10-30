import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

const source = readFileSync(new URL('../../native/recorder.js', import.meta.url), 'utf8')
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
function microphone() {
  const state = { stops: 0, starts: 0 }
  return {
    state,
    getTracks: () => [
      {
        stop: () => {
          state.stops++
        }
      }
    ]
  }
}
function harness() {
  let start: (model: string, epoch: number) => Promise<void> = async () => {}
  let stop = () => {},
    cancel = () => {}
  const pending: ReturnType<typeof deferred<ReturnType<typeof microphone>>>[] = []
  let cancellations = 0
  const recorders: FakeRecorder[] = []
  class FakeRecorder {
    state = 'inactive'
    onstop: (() => void) | null = null
    onstart: (() => void) | null = null
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    mimeType = 'audio/webm'
    constructor(public stream: ReturnType<typeof microphone>) {
      recorders.push(this)
    }
    start() {
      this.state = 'recording'
      this.stream.state.starts++
      this.onstart?.()
    }
    stop() {
      this.state = 'inactive'
      this.onstop?.()
    }
  }
  runInNewContext(source, {
    document: { getElementById: () => ({ textContent: '' }) },
    navigator: {
      mediaDevices: {
        getUserMedia: () => {
          const item = deferred<ReturnType<typeof microphone>>()
          pending.push(item)
          return item.promise
        }
      }
    },
    window: {
      recorder: {
        onStart: (fn: typeof start) => {
          start = fn
        },
        onStop: (fn: typeof stop) => {
          stop = fn
        },
        onCancel: (fn: typeof cancel) => {
          cancel = fn
        },
        cancel: () => {
          cancellations++
        },
        transcribe: async () => ({})
      }
    },
    MediaRecorder: FakeRecorder,
    Blob,
    Uint8Array,
    setTimeout: () => 0
  })
  return { start, stop, cancel, pending, recorders, cancellations: () => cancellations }
}

it('stopping before permission resolves never records behind the hidden HUD', async () => {
  const h = harness(),
    mic = microphone()
  const started = h.start('cloud', 1)
  h.stop()
  h.pending[0].resolve(mic)
  await started
  expect(mic.state).toEqual({ stops: 1, starts: 0 })
  expect(h.cancellations()).toBe(1)
})

it('late old acquisition cannot replace or stop a newer recording', async () => {
  const h = harness(),
    old = microphone(),
    next = microphone()
  const first = h.start('cloud', 1)
  await h.start('cloud', 1)
  expect(h.pending).toHaveLength(1)
  h.cancel()
  const second = h.start('cloud', 2)
  h.pending[1].resolve(next)
  await second
  h.pending[0].resolve(old)
  await first
  expect(old.state).toEqual({ stops: 1, starts: 0 })
  expect(next.state).toEqual({ stops: 0, starts: 1 })
  h.cancel()
  expect(next.state.stops).toBe(1)
  expect(h.recorders[0].state).toBe('inactive')
})
