export const SAMPLE_RATE: number
export function prepareAudio(): Promise<AudioContext>
export function encodeWav(chunks: Float32Array[]): Uint8Array
export function captureAudio(options: {
  deviceId?: string
  onReady(): void
  onFallback(message: string): void
  onError(error: Error): void
}): {
  readonly analyser?: AnalyserNode
  ready: Promise<void>
  stop(): Promise<Uint8Array>
  cancel(): void
}
