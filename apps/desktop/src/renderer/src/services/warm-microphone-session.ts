type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>

function isLiveAudioStream(stream: MediaStream | null): stream is MediaStream {
  return (
    stream !== null &&
    stream.getAudioTracks().some((track) => track.readyState === 'live')
  )
}

function setAudioTracksEnabled(stream: MediaStream, enabled: boolean): void {
  for (const track of stream.getAudioTracks()) {
    track.enabled = enabled
  }
}

function stopStream(stream: MediaStream | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) {
    track.stop()
  }
}

function constraintsForDevice(deviceId: string): MediaStreamConstraints {
  return {
    audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } }
  }
}

/**
 * Keeps a permission-granted microphone stream warm but disabled between
 * recordings. No MediaRecorder exists while idle, and enabling the live track
 * on hotkey press avoids a new CoreAudio/getUserMedia startup round trip.
 */
export class WarmMicrophoneSession {
  private stream: MediaStream | null = null
  private streamDeviceId: string | null = null
  private acquisition: { deviceId: string; promise: Promise<MediaStream> } | null = null
  private captureActive = false
  private generation = 0
  private desiredDeviceId: string | null = null

  constructor(private readonly getUserMedia: GetUserMedia) {}

  async warm(deviceId: string): Promise<void> {
    this.desiredDeviceId = deviceId
    const stream = await this.ensureStream(deviceId)
    if (!this.captureActive) {
      setAudioTracksEnabled(stream, false)
    }
  }

  async activate(deviceId: string): Promise<MediaStream> {
    this.desiredDeviceId = deviceId
    this.captureActive = true
    try {
      const stream = await this.ensureStream(deviceId)
      setAudioTracksEnabled(stream, true)
      return stream
    } catch (error) {
      this.captureActive = false
      throw error
    }
  }

  setCaptureEnabled(enabled: boolean): void {
    if (isLiveAudioStream(this.stream)) {
      setAudioTracksEnabled(this.stream, enabled)
    }
  }

  deactivate(): void {
    this.captureActive = false
    this.setCaptureEnabled(false)
  }

  dispose(): void {
    this.captureActive = false
    this.desiredDeviceId = null
    this.generation += 1
    stopStream(this.stream)
    this.stream = null
    this.streamDeviceId = null
    this.acquisition = null
  }

  private async ensureStream(deviceId: string): Promise<MediaStream> {
    if (isLiveAudioStream(this.stream) && this.streamDeviceId === deviceId) {
      return this.stream
    }
    if (this.acquisition?.deviceId === deviceId) {
      return this.acquisition.promise
    }

    this.generation += 1
    const generation = this.generation
    stopStream(this.stream)
    this.stream = null
    this.streamDeviceId = null

    const promise = this.acquireStream(deviceId).then((stream) => {
      if (generation !== this.generation) {
        stopStream(stream)
        throw new Error('microphone_acquisition_superseded')
      }
      this.stream = stream
      this.streamDeviceId = deviceId
      for (const track of stream.getAudioTracks()) {
        track.addEventListener(
          'ended',
          () => {
            if (
              this.stream !== stream ||
              this.captureActive ||
              this.desiredDeviceId !== deviceId
            ) {
              return
            }
            this.stream = null
            this.streamDeviceId = null
            void this.warm(deviceId).catch((error) => {
              console.warn('[WarmMicrophoneSession] Failed to restore ended input stream:', error)
            })
          },
          { once: true }
        )
      }
      if (!this.captureActive) {
        setAudioTracksEnabled(stream, false)
      }
      return stream
    })
    this.acquisition = { deviceId, promise }

    try {
      return await promise
    } finally {
      if (this.acquisition?.promise === promise) {
        this.acquisition = null
      }
    }
  }

  private async acquireStream(deviceId: string): Promise<MediaStream> {
    try {
      return await this.getUserMedia(constraintsForDevice(deviceId))
    } catch (error) {
      if (deviceId === 'default') throw error
      console.warn(
        '[WarmMicrophoneSession] Selected input unavailable; falling back to default input'
      )
      return this.getUserMedia({ audio: true })
    }
  }
}
