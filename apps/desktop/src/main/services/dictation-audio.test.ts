import { expect, it } from 'vitest'
import { encodeWav } from '../../native/dictation-audio.js'

it('encodes mono 16kHz PCM directly with clipping and a valid RIFF length', () => {
  const bytes = encodeWav([new Float32Array([-2, -1, 0, 0.5, 1, 2, NaN])])
  const view = new DataView(bytes.buffer)
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
  expect(view.getUint32(4, true)).toBe(bytes.length - 8)
  expect(view.getUint32(24, true)).toBe(16000)
  expect(view.getUint16(22, true)).toBe(1)
  expect(Array.from({ length: 7 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([
    -32768, -32768, 0, 16384, 32767, 32767, 0
  ])
})
it('bounds recordings and rejects empty audio before upload', () => {
  expect(() => encodeWav([])).toThrow()
  expect(() => encodeWav([new Float32Array((25 * 1024 * 1024) / 2)])).toThrow()
})
