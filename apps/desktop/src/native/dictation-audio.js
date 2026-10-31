export const SAMPLE_RATE = 16000
const MAX_SAMPLES = (25 * 1024 * 1024 - 44) / 2
let prepared

// Preparing a suspended graph never acquires a microphone or records idle audio.
export function prepareAudio() {
  if (!prepared) {
    prepared = (async () => {
      const context = new AudioContext({
        sampleRate: SAMPLE_RATE,
        latencyHint: 'interactive',
        sinkId: { type: 'none' }
      })
      try {
        await context.suspend()
        await context.audioWorklet.addModule(new URL('./dictation-worklet.js', import.meta.url))
        // Initialize the processing thread at launch, with no microphone and no output device.
        const warm = new AudioWorkletNode(context, 'overlay-dictation')
        const silence = context.createConstantSource()
        silence.offset.value = 0
        silence.connect(warm)
        try {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Audio preparation timed out.')), 5000)
            warm.port.onmessage = ({ data }) => {
              if (data instanceof Float32Array) {
                clearTimeout(timer)
                resolve()
              }
            }
            warm.connect(context.destination)
            silence.start()
            void context.resume().catch((error) => {
              clearTimeout(timer)
              reject(error)
            })
          })
        } finally {
          silence.stop()
          silence.disconnect()
          warm.disconnect()
          warm.port.onmessage = null
          warm.port.close()
          await context.suspend()
        }
        return context
      } catch (error) {
        await context.close()
        prepared = undefined
        throw error
      }
    })()
  }
  return prepared
}

export function encodeWav(chunks) {
  const length = chunks.reduce((size, chunk) => size + chunk.length, 0)
  if (!length || length > MAX_SAMPLES) throw new Error('Try a shorter recording.')
  const bytes = new Uint8Array(44 + length * 2)
  const view = new DataView(bytes.buffer)
  const text = (offset, value) =>
    [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, bytes.length - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, length * 2, true)
  let index = 44
  for (const chunk of chunks)
    for (const sample of chunk) {
      const bounded = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0))
      view.setInt16(index, Math.round(bounded * (bounded < 0 ? 32768 : 32767)), true)
      index += 2
    }
  return bytes
}

async function microphone(deviceId, signal, onFallback) {
  const open = (id) =>
    navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
        ...(id ? { deviceId: { exact: id } } : {})
      }
    })
  let selected = deviceId
  if (selected === 'auto') {
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
    selected =
      devices.find(
        (device) =>
          device.kind === 'audioinput' && /built.?in|macbook|imac|internal/i.test(device.label)
      )?.deviceId ?? ''
  }
  let stream
  try {
    stream = await open(selected)
  } catch (error) {
    if (
      !selected ||
      !['NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(error.name)
    )
      throw error
    signal.throwIfAborted()
    stream = await open('')
    onFallback('Using the default microphone')
  }
  if (signal.aborted) {
    stream.getTracks().forEach((track) => track.stop())
    signal.throwIfAborted()
  }
  return stream
}

export function captureAudio({ deviceId = 'auto', onReady, onFallback, onError }) {
  const abort = new AbortController()
  const chunks = []
  let stream, source, processor, analyser, context, stopped, resolveFlush
  let samples = 0,
    firstFrame = false
  const cleanup = async () => {
    if (stream)
      for (const track of stream.getTracks()) {
        track.onended = null
        track.stop()
      }
    source?.disconnect()
    processor?.disconnect()
    analyser?.disconnect()
    if (processor) {
      processor.port.onmessage = null
      processor.port.close()
    }
    if (context && context.state !== 'closed') await context.suspend().catch(() => {})
  }
  // Start device acquisition and graph preparation together; neither waits for cloud auth.
  const device = microphone(deviceId, abort.signal, onFallback)
  const graph = prepareAudio()
  const ready = (async () => {
    try {
      ;[stream, context] = await Promise.all([device, graph])
      abort.signal.throwIfAborted()
      await context.resume()
      abort.signal.throwIfAborted()
      source = context.createMediaStreamSource(stream)
      analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0
      processor = new AudioWorkletNode(context, 'overlay-dictation')
      processor.port.onmessage = ({ data }) => {
        if (data === 'flushed') {
          resolveFlush?.()
          return
        }
        if (abort.signal.aborted || !(data instanceof Float32Array)) return
        if (samples + data.length > MAX_SAMPLES) {
          onError(new Error('Try a shorter recording.'))
          return
        }
        samples += data.length
        chunks.push(data)
        if (!firstFrame) {
          firstFrame = true
          onReady()
        }
      }
      processor.onprocessorerror = () => onError(new Error('The microphone stopped. Try again.'))
      for (const track of stream.getTracks())
        track.onended = () => {
          if (!stopped && !abort.signal.aborted)
            onError(new Error('The microphone disconnected. Try again.'))
        }
      source.connect(analyser)
      source.connect(processor)
      processor.connect(context.destination) // The processor emits silence, never microphone playback.
    } catch (error) {
      abort.abort()
      // Promise.all can reject before the other acquisition finishes.
      void device.then(
        (value) => value.getTracks().forEach((track) => track.stop()),
        () => {}
      )
      await cleanup()
      throw error
    }
  })()
  ready.catch(() => {})
  return {
    ready,
    get analyser() {
      return analyser
    },
    async stop() {
      if (stopped) return stopped
      stopped = (async () => {
        await ready
        abort.signal.throwIfAborted()
        if (processor) {
          await Promise.race([
            new Promise((resolve) => {
              resolveFlush = resolve
              processor.port.postMessage('flush')
            }),
            new Promise((resolve) => setTimeout(resolve, 120))
          ])
        }
        await cleanup()
        return encodeWav(chunks)
      })()
      return stopped
    },
    cancel() {
      abort.abort()
      chunks.length = 0
      void cleanup()
      void device.then(
        (value) => value.getTracks().forEach((track) => track.stop()),
        () => {}
      )
    }
  }
}
