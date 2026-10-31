import { captureAudio, prepareAudio } from './dictation-audio.js'

let capture,
  epoch = 0,
  selected,
  recordingEpoch,
  audio,
  retryTimer,
  frame,
  phase = 'idle'
const status = document.getElementById('status')
const notice = document.getElementById('notice')
const meter = document.getElementById('meter')
const ctx = meter.getContext('2d')
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const buttons = Object.fromEntries(
  ['finish', 'retry', 'copy', 'cancel'].map((id) => [id, document.getElementById(id)])
)
function state(next, message, detail = '') {
  phase = next
  document.body.dataset.phase = next
  status.textContent = message
  notice.textContent = detail
  buttons.finish.hidden = next !== 'listening' && next !== 'opening'
  buttons.retry.hidden = next !== 'error' || !audio
  buttons.copy.hidden = next !== 'ready'
}
let levels = Array(9).fill(2),
  last = 0
function draw(now) {
  const ratio = devicePixelRatio || 1
  if (meter.width !== 42 * ratio) {
    meter.width = 42 * ratio
    meter.height = 22 * ratio
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, 42, 22)
  const bins = new Uint8Array(128)
  capture?.analyser?.getByteFrequencyData(bins)
  const dt = Math.min(50, now - (last || now))
  last = now
  for (let i = 0; i < 9; i++) {
    const energy = Math.max(...bins.slice(2 + i * 3, 5 + i * 3)) / 255
    const target = phase === 'listening' ? 2 + Math.pow(energy, 1.4) * 18 : 2
    levels[i] += (target - levels[i]) * (1 - Math.exp(-dt / (target > levels[i] ? 30 : 110)))
    const height = reducedMotion.matches ? (phase === 'listening' ? 6 : 2) : levels[i]
    ctx.fillStyle = phase === 'listening' ? '#f1f1f1' : '#929292'
    ctx.beginPath()
    ctx.roundRect(i * 4.7, (22 - height) / 2, 2.3, height, 1.2)
    ctx.fill()
  }
  frame = requestAnimationFrame(draw)
}
function release() {
  ++epoch
  capture?.cancel()
  capture = undefined
  audio = undefined
  clearTimeout(retryTimer)
  cancelAnimationFrame(frame)
  last = 0
  levels.fill(2)
}
function fail(error) {
  capture?.cancel()
  capture = undefined
  state('error', 'Try again', error?.message || 'Dictation failed. Check Desktop settings.')
  window.recorder.failed(recordingEpoch)
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    release()
    window.recorder.cancel()
  }, 60_000)
}
async function submit(started) {
  state('processing', 'Transcribing…')
  try {
    const result = await window.recorder.transcribe(
      { audio, mime: 'audio/wav', model: selected },
      recordingEpoch
    )
    if (started !== epoch) return
    audio = undefined
    if (result.delivery === 'copy') {
      state(
        'ready',
        'Ready to copy',
        'Your destination changed or paste was unavailable. Copy your text to continue.'
      )
    } else {
      state('delivered', 'Inserted')
      setTimeout(() => {
        if (started === epoch) window.recorder.cancel()
      }, 550)
    }
  } catch (error) {
    if (started === epoch) fail(error)
  }
}
window.recorder.onStart((model, take, deviceId) => {
  release()
  selected = model
  recordingEpoch = take
  const started = epoch,
    began = performance.now()
  state('opening', 'Opening mic…')
  frame = requestAnimationFrame(draw)
  capture = captureAudio({
    deviceId,
    onReady: () => {
      if (started !== epoch || phase !== 'opening') return
      state('listening', 'Listening…')
      window.recorder.ready(take, performance.now() - began)
    },
    onFallback: (message) => {
      if (started === epoch) notice.textContent = message
    },
    onError: (error) => {
      if (started === epoch) fail(error)
    }
  })
  capture.ready.catch((error) => {
    if (started === epoch)
      fail(
        new Error(
          error.name === 'NotAllowedError'
            ? 'Allow microphone access in System Settings.'
            : 'Could not open the microphone. Try again.'
        )
      )
  })
  retryTimer = setTimeout(() => {
    if (started === epoch && phase === 'opening')
      fail(new Error('The microphone did not respond. Check System Settings.'))
  }, 15_000)
})
window.recorder.onStop(async () => {
  if (!capture || !['opening', 'listening'].includes(phase)) return
  const started = epoch
  if (phase === 'opening') {
    release()
    window.recorder.cancel()
    return
  }
  state('processing', 'Transcribing…')
  clearTimeout(retryTimer)
  try {
    audio = await capture.stop()
    capture = undefined
    if (started === epoch) await submit(started)
  } catch (error) {
    if (started === epoch) fail(error)
  }
})
window.recorder.onCancel(() => {
  release()
  state('idle', 'Ready')
})
buttons.finish.onclick = () => window.recorder.finish()
buttons.cancel.onclick = () => {
  release()
  window.recorder.cancel()
}
buttons.retry.onclick = () => {
  clearTimeout(retryTimer)
  void submit(epoch)
}
buttons.copy.onclick = async () => {
  try {
    await window.recorder.copy(recordingEpoch)
    state('copied', 'Copied')
    audio = undefined
  } catch {
    state('error', 'Copy failed', 'Please try again.')
  }
}
// No stream is opened until the native shortcut is activated.
void prepareAudio().catch(() => {})
