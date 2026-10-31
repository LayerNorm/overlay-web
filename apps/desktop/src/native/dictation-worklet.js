// Small, unencoded frames keep capture, visual feedback and future transports independent.
class DictationCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.frames = new Float32Array(256)
    this.offset = 0
    this.port.postMessage('prepared')
    this.port.onmessage = () => {
      if (this.offset) this.port.postMessage(this.frames.slice(0, this.offset))
      this.port.postMessage('flushed')
      this.stopped = true
    }
  }
  process(inputs) {
    if (this.stopped) return false
    const channel = inputs[0]?.[0]
    if (!channel) return true
    for (let index = 0; index < channel.length; index++) {
      this.frames[this.offset++] = channel[index]
      if (this.offset === this.frames.length) {
        this.port.postMessage(this.frames.slice())
        this.offset = 0
      }
    }
    return true
  }
}
registerProcessor('overlay-dictation', DictationCapture)
