/**
 * Simple WAV encoder for Web Audio API
 * Converts raw PCM audio data to WAV format
 */

export class WavEncoder {
  private sampleRate: number
  private numChannels: number
  private buffers: Float32Array[][] = []

  constructor(sampleRate: number, numChannels: number) {
    this.sampleRate = sampleRate
    this.numChannels = numChannels
  }

  /**
   * Add audio data to the encoder
   */
  addBuffer(buffer: Float32Array[]) {
    this.buffers.push(buffer)
  }

  /**
   * Encode all buffered audio data to WAV format
   */
  encode(): Blob {
    // Calculate total length
    const totalLength = this.buffers.reduce((acc, buf) => acc + buf[0].length, 0)

    // Interleave channels
    const interleaved = new Float32Array(totalLength * this.numChannels)
    let offset = 0

    for (const buffer of this.buffers) {
      for (let i = 0; i < buffer[0].length; i++) {
        for (let channel = 0; channel < this.numChannels; channel++) {
          interleaved[offset++] = buffer[channel][i]
        }
      }
    }

    // Convert to 16-bit PCM
    const pcm = new Int16Array(interleaved.length)
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]))
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }

    // Create WAV file
    const wavBuffer = this.createWavBuffer(pcm)
    return new Blob([wavBuffer], { type: 'audio/wav' })
  }

  /**
   * Create WAV file buffer with proper headers
   */
  private createWavBuffer(pcmData: Int16Array): ArrayBuffer {
    const bytesPerSample = 2 // 16-bit
    const blockAlign = this.numChannels * bytesPerSample
    const byteRate = this.sampleRate * blockAlign
    const dataSize = pcmData.length * bytesPerSample
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)

    // RIFF chunk descriptor
    this.writeString(view, 0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    this.writeString(view, 8, 'WAVE')

    // fmt sub-chunk
    this.writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true) // fmt chunk size
    view.setUint16(20, 1, true) // audio format (1 = PCM)
    view.setUint16(22, this.numChannels, true)
    view.setUint32(24, this.sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bytesPerSample * 8, true) // bits per sample

    // data sub-chunk
    this.writeString(view, 36, 'data')
    view.setUint32(40, dataSize, true)

    // Write PCM data
    const offset = 44
    for (let i = 0; i < pcmData.length; i++) {
      view.setInt16(offset + i * 2, pcmData[i], true)
    }

    return buffer
  }

  /**
   * Write string to DataView
   */
  private writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i))
    }
  }

  /**
   * Clear all buffered data
   */
  clear() {
    this.buffers = []
  }
}
