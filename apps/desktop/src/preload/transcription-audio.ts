import { methodSchemas } from '../../packages/overlay-desktop-bridge/src/index'

/** Decode Chromium capture before handing local inference a Core Audio file. */
export async function prepareTranscriptionAudio(input: unknown): Promise<unknown> {
  const parsed = methodSchemas['transcription.transcribe'].safeParse(input)
  // Main remains the authority for invalid arguments. Cloud accepts capture
  // containers directly; native model helpers require PCM rather than WebM.
  if (!parsed.success || parsed.data.model === 'cloud' || parsed.data.mime === 'audio/wav')
    return input
  const context = new AudioContext({ sampleRate: 16_000 })
  try {
    const decoded = await context.decodeAudioData(new Uint8Array(parsed.data.audio).buffer)
    const size = 44 + decoded.length * 2
    if (size > 25 * 1024 * 1024) throw new Error('The recording is too long. Try a shorter recording.')
    const audio = new Uint8Array(size)
    const view = new DataView(audio.buffer)
    const text = (offset: number, value: string): void => {
      for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
    }
    text(0, 'RIFF'); view.setUint32(4, size - 8, true); text(8, 'WAVE')
    text(12, 'fmt '); view.setUint32(16, 16, true)
    view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, decoded.sampleRate, true); view.setUint32(28, decoded.sampleRate * 2, true)
    view.setUint16(32, 2, true); view.setUint16(34, 16, true)
    text(36, 'data'); view.setUint32(40, size - 44, true)
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index))
    for (let index = 0; index < decoded.length; index++) {
      const sample = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[index], 0) / channels.length))
      view.setInt16(44 + index * 2, sample * (sample < 0 ? 0x8000 : 0x7fff), true)
    }
    return { ...parsed.data, audio, mime: 'audio/wav' }
  } finally {
    await context.close()
  }
}
