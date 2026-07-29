export type NativeRecordingStartEvent = {
  nativeCapture: boolean
  error?: string
}

export type NativeRecordingPayload = {
  mime: 'audio/wav'
  data: Uint8Array
  duration: number
  activationLatencyMs: number | null
}

export type NativeRecordingStopEvent = {
  nativeRecording?: NativeRecordingPayload
  error?: string
}

export type NativeRecordingCancelEvent = {
  nativeCapture: boolean
}
