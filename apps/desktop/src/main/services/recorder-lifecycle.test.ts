import { afterEach, expect, it, vi } from 'vitest'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
function microphone() {
  const track = { stop: vi.fn(), onended: null }
  return { getTracks: () => [track], track }
}
async function harness() {
  vi.resetModules()
  const pending: ReturnType<typeof deferred<ReturnType<typeof microphone>>>[] = []
  const connected: unknown[] = []
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  vi.stubGlobal('navigator', {
    mediaDevices: {
      enumerateDevices: async () => [],
      getUserMedia: () => {
        const next = deferred<ReturnType<typeof microphone>>()
        pending.push(next)
        return next.promise
      }
    }
  })
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'suspended'
      audioWorklet = { addModule: async () => {} }
      destination = {}
      suspend = async () => {
        this.state = 'suspended'
      }
      resume = async () => {
        this.state = 'running'
      }
      close = async () => {}
      createMediaStreamSource = (stream: unknown) => {
        connected.push(stream)
        return node()
      }
      createAnalyser = () => node()
    }
  )
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port: {
        onmessage: ((event: { data: string }) => void) | null
        close(): void
        postMessage(): void
      } = { onmessage: null, close: () => {}, postMessage: () => {} }
      constructor() {
        queueMicrotask(() => this.port.onmessage?.({ data: 'prepared' }))
      }
      connect = () => {}
      disconnect = () => {}
    }
  )
  const { captureAudio, prepareAudio } = await import('../../native/dictation-audio.js')
  const start = () => captureAudio({ onReady: vi.fn(), onFallback: vi.fn(), onError: vi.fn() })
  return { start, pending, connected, prepareAudio }
}
afterEach(() => vi.unstubAllGlobals())
it('cancellation before permission resolves releases the late microphone without connecting it', async () => {
  const h = await harness(),
    mic = microphone()
  const take = h.start()
  await vi.waitFor(() => expect(h.pending).toHaveLength(1))
  take.cancel()
  h.pending[0].resolve(mic)
  await expect(take.ready).rejects.toThrow()
  expect(mic.track.stop).toHaveBeenCalled()
  expect(h.connected).toHaveLength(0)
})
it('a late old microphone cannot replace or disconnect a newer take', async () => {
  const h = await harness(),
    old = microphone(),
    next = microphone()
  const first = h.start()
  await vi.waitFor(() => expect(h.pending).toHaveLength(1))
  first.cancel()
  const second = h.start()
  await vi.waitFor(() => expect(h.pending).toHaveLength(2))
  h.pending[1].resolve(next)
  await second.ready
  h.pending[0].resolve(old)
  await expect(first.ready).rejects.toThrow()
  expect(h.connected).toEqual([next])
  expect(old.track.stop).toHaveBeenCalled()
  expect(next.track.stop).not.toHaveBeenCalled()
  second.cancel()
  expect(next.track.stop).toHaveBeenCalled()
})

it('prepares and suspends the processor without acquiring a microphone', async () => {
  const h = await harness()
  const context = await h.prepareAudio()
  expect(context.state).toBe('suspended')
  expect(h.pending).toHaveLength(0)
  expect(h.connected).toHaveLength(0)
})
