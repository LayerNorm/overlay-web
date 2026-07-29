import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { createInterface, type Interface } from 'node:readline'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createLocalHelperEnvironment } from './security/local-helper-process'

const HELPER_PROTOCOL_VERSION = 1
const MAX_RECORDING_BYTES = 26 * 1024 * 1024
const COMMAND_TIMEOUT_MS = 5_000

type HelperMessage = Record<string, unknown> & {
  type: string
}

type PendingCommand = {
  resolve: (message: HelperMessage) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export type NativeRecordingStartResult = {
  started: boolean
  nativeCapture: boolean
  error?: string
}

export type NativeRecordingResult = {
  mime: 'audio/wav'
  data: Buffer
  duration: number
  activationLatencyMs: number | null
}

export function parseNativeAudioHelperMessage(line: string): HelperMessage | null {
  try {
    const value = JSON.parse(line) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const message = value as Record<string, unknown>
    return typeof message.type === 'string' ? (message as HelperMessage) : null
  } catch {
    return null
  }
}

export function isRecordingPathAllowed(outputDirectory: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false
  const child = relative(resolve(outputDirectory), resolve(candidate))
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child)
}

export function findNativeAudioHelperPath(options?: {
  resourcesPath?: string
  appPath?: string
  moduleDirectory?: string
}): string | null {
  const resourcesPath = options?.resourcesPath ?? process.resourcesPath ?? ''
  const appPath = options?.appPath ?? app.getAppPath()
  const moduleDirectory = options?.moduleDirectory ?? __dirname
  const candidates = [
    join(resourcesPath, 'native-audio-helper'),
    join(appPath, 'resources', 'native-audio-helper'),
    join(moduleDirectory, '..', '..', '..', 'resources', 'native-audio-helper')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

class NativeAudioCaptureService extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private lines: Interface | null = null
  private initialization: Promise<boolean> | null = null
  private readyResolve: ((available: boolean) => void) | null = null
  private pending = new Map<string, PendingCommand>()
  private outputDirectory: string | null = null
  private activationLatencyMs: number | null = null
  private recording = false
  private shuttingDown = false
  private configuredUseDefaultDevice = true
  private configuredDeviceLabel: string | null = null

  async initialize(): Promise<boolean> {
    if (process.platform !== 'darwin' || this.shuttingDown) return false
    if (this.initialization) return this.initialization
    if (this.child && !this.child.killed) return true

    this.initialization = this.spawnHelper()
    try {
      return await this.initialization
    } finally {
      this.initialization = null
    }
  }

  async configure(options: { useDefaultDevice: boolean; deviceLabel?: string }): Promise<void> {
    this.configuredUseDefaultDevice = options.useDefaultDevice
    this.configuredDeviceLabel =
      options.useDefaultDevice || !options.deviceLabel?.trim() ? null : options.deviceLabel.trim()
    if (!(await this.initialize())) return
    const response = await this.command('configure', {
      deviceLabel: this.configuredDeviceLabel
    })
    if (response.ok !== true) {
      throw new Error(
        typeof response.error === 'string' ? response.error : 'native_configure_failed'
      )
    }
  }

  async start(options?: {
    useDefaultDevice: boolean
    deviceLabel?: string
  }): Promise<NativeRecordingStartResult> {
    const useDefaultDevice = options?.useDefaultDevice ?? this.configuredUseDefaultDevice
    const deviceLabel = useDefaultDevice
      ? null
      : (options?.deviceLabel?.trim() ?? this.configuredDeviceLabel)
    if (!useDefaultDevice && !deviceLabel) {
      return {
        started: false,
        nativeCapture: false,
        error: 'selected_input_label_unavailable'
      }
    }
    if (!(await this.initialize())) {
      return { started: false, nativeCapture: false, error: 'native_capture_unavailable' }
    }
    try {
      this.activationLatencyMs = null
      const response = await this.command('start', { deviceLabel })
      if (response.ok !== true) {
        return {
          started: false,
          nativeCapture: false,
          error: typeof response.error === 'string' ? response.error : 'native_start_failed'
        }
      }
      this.recording = true
      return { started: true, nativeCapture: true }
    } catch (error) {
      return {
        started: false,
        nativeCapture: false,
        error: error instanceof Error ? error.message : 'native_start_failed'
      }
    }
  }

  async stop(): Promise<NativeRecordingResult> {
    const outputDirectory = this.outputDirectory
    if (!this.recording || !outputDirectory) throw new Error('native_recording_not_active')
    const response = await this.command('stop')
    this.recording = false
    if (response.ok !== true || typeof response.path !== 'string') {
      throw new Error(typeof response.error === 'string' ? response.error : 'native_stop_failed')
    }
    if (!isRecordingPathAllowed(outputDirectory, response.path)) {
      throw new Error('native_recording_path_rejected')
    }

    try {
      const metadata = await stat(response.path)
      if (!metadata.isFile() || metadata.size <= 100 || metadata.size > MAX_RECORDING_BYTES) {
        throw new Error('native_recording_size_rejected')
      }
      const data = await readFile(response.path)
      return {
        mime: 'audio/wav',
        data,
        duration:
          typeof response.duration === 'number' && Number.isFinite(response.duration)
            ? Math.max(0, response.duration)
            : 0,
        activationLatencyMs: this.activationLatencyMs
      }
    } finally {
      await rm(response.path, { force: true })
    }
  }

  async cancel(): Promise<void> {
    if (!this.recording) return
    try {
      await this.command('cancel')
    } finally {
      this.recording = false
      this.activationLatencyMs = null
    }
  }

  async pause(): Promise<void> {
    if (!this.recording) return
    const response = await this.command('pause')
    if (response.ok !== true) throw new Error('native_pause_failed')
  }

  async resume(): Promise<void> {
    if (!this.recording) return
    const response = await this.command('resume')
    if (response.ok !== true) throw new Error('native_resume_failed')
  }

  isRecording(): boolean {
    return this.recording
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const child = this.child
    if (!child) return
    try {
      await this.command('shutdown', {}, 1_000)
    } catch {
      child.kill('SIGTERM')
    } finally {
      this.disposeChild(new Error('native_audio_shutdown'))
    }
  }

  terminate(): void {
    this.shuttingDown = true
    const child = this.child
    if (child && !child.killed) child.kill('SIGTERM')
    this.disposeChild(new Error('native_audio_terminated'))
  }

  private async spawnHelper(): Promise<boolean> {
    const helperPath = findNativeAudioHelperPath()
    if (!helperPath) {
      console.warn('[NativeAudio] Helper not found; browser capture fallback will be used')
      return false
    }

    const outputDirectory = join(app.getPath('temp'), 'overlay-native-audio')
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
    this.outputDirectory = outputDirectory
    this.shuttingDown = false

    const child = spawn(helperPath, ['--output-dir', outputDirectory], {
      env: createLocalHelperEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    const readyPromise = new Promise<boolean>((resolveReady) => {
      const timeout = setTimeout(() => {
        if (this.readyResolve === complete) this.readyResolve = null
        child.kill('SIGTERM')
        resolveReady(false)
      }, COMMAND_TIMEOUT_MS)
      const complete = (available: boolean): void => {
        clearTimeout(timeout)
        resolveReady(available)
      }
      this.readyResolve = complete
    })
    this.lines = createInterface({ input: child.stdout })
    this.lines.on('line', (line) => this.handleLine(line))
    child.stderr.on('data', (chunk) => {
      const line = String(chunk).trim()
      if (line) console.warn('[NativeAudio] helper stderr:', line.slice(0, 500))
    })
    child.once('error', (error) => this.disposeChild(error))
    child.once('exit', (code, signal) => {
      if (!this.shuttingDown) {
        console.warn(`[NativeAudio] Helper exited (code=${code}, signal=${signal})`)
      }
      this.disposeChild(new Error('native_audio_helper_exited'))
    })

    return readyPromise
  }

  private handleLine(line: string): void {
    const message = parseNativeAudioHelperMessage(line)
    if (!message) {
      console.warn('[NativeAudio] Ignoring malformed helper output')
      return
    }
    if (message.type === 'ready') {
      const compatible = message.protocolVersion === HELPER_PROTOCOL_VERSION
      console.log('[NativeAudio] Helper ready:', {
        compatible,
        prepared: message.prepared === true,
        authorization: message.authorization,
        inputRunning: message.inputRunning === true
      })
      const resolveReady = this.readyResolve
      this.readyResolve = null
      resolveReady?.(compatible)
      return
    }
    if (message.type === 'capture-active') {
      if (typeof message.activationLatencyMs === 'number') {
        this.activationLatencyMs = message.activationLatencyMs
        console.log(
          '[NativeAudio] Hotkey-to-first-audio latency:',
          `${Math.round(message.activationLatencyMs)}ms`
        )
      }
      return
    }
    if (message.type === 'level') {
      if (typeof message.level === 'number' && Number.isFinite(message.level)) {
        this.emit('level', Math.max(0, Math.min(1, message.level)))
      }
      return
    }
    if (message.type === 'recorder-error' || message.type === 'warning') {
      console.warn('[NativeAudio] Helper event:', message.type, message.error ?? message.warning)
      return
    }
    if (message.type !== 'response' || typeof message.id !== 'string') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pending.delete(message.id)
    pending.resolve(message)
  }

  private command(
    command: string,
    fields: Record<string, unknown> = {},
    timeoutMs = COMMAND_TIMEOUT_MS
  ): Promise<HelperMessage> {
    const child = this.child
    if (!child || child.killed || !child.stdin.writable) {
      return Promise.reject(new Error('native_audio_helper_unavailable'))
    }
    const id = randomUUID()
    return new Promise<HelperMessage>((resolveCommand, rejectCommand) => {
      const timeout = setTimeout(() => {
        this.disposeChild(new Error(`native_audio_${command}_timeout`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timeout })
      child.stdin.write(`${JSON.stringify({ id, command, ...fields })}\n`, (error) => {
        if (!error) return
        clearTimeout(timeout)
        this.pending.delete(id)
        rejectCommand(error)
      })
    })
  }

  private disposeChild(error: Error): void {
    const child = this.child
    this.child = null
    this.lines?.close()
    this.lines = null
    this.recording = false
    this.activationLatencyMs = null
    const resolveReady = this.readyResolve
    this.readyResolve = null
    resolveReady?.(false)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    if (child && !child.killed) child.kill('SIGTERM')
  }
}

export const nativeAudioCaptureService = new NativeAudioCaptureService()
