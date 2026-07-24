import { execFile } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { modelDownloadService } from './model-download-service'
import { createLocalHelperEnvironment } from './security/local-helper-process'

const execFileAsync = promisify(execFile)
const MAX_AUDIO_BYTES = 250 * 1024 * 1024
const MAX_REPORT_BYTES = 5 * 1024 * 1024
const SAFE_MODEL_ID = /^[A-Za-z0-9._-]{1,128}$/

interface WhisperKitConfig {
  model: string
  verbose: boolean
}

interface TranscriptionOptions {
  language?: string
  temperature?: number
  stream?: boolean
  prompt?: string
  timeout?: number
}

interface TranscriptionResult {
  text: string
  language?: string
  duration?: number
}

class WhisperKitService {
  private readonly readyModels = new Set<string>()
  private readonly config: WhisperKitConfig
  private currentModelId: string

  constructor(config?: Partial<WhisperKitConfig>) {
    this.config = {
      model: 'openai_whisper-base',
      verbose: false,
      ...config
    }
    this.currentModelId = this.config.model
  }

  private getWhisperKitPath(): { binaryPath: string; workingDir: string } {
    if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
      const workingDir = join(process.cwd(), 'whisperkit-bundle')
      return { binaryPath: join(workingDir, 'whisperkit-cli'), workingDir }
    }
    const workingDir = join(process.resourcesPath, 'whisperkit')
    return { binaryPath: join(workingDir, 'whisperkit-cli'), workingDir }
  }

  private getModelPath(modelId: string): string {
    if (!SAFE_MODEL_ID.test(modelId)) throw new Error('invalid_whisper_model_id')
    const base = resolve(modelDownloadService.getModelsBasePath())
    const candidate = resolve(base, modelId)
    if (!candidate.startsWith(`${base}${sep}`)) throw new Error('invalid_whisper_model_path')
    return candidate
  }

  public isAvailable(): boolean {
    try {
      return existsSync(this.getWhisperKitPath().binaryPath)
    } catch {
      return false
    }
  }

  /**
   * Kept for renderer compatibility. Readiness now means the one-shot binary
   * and model are present; no localhost HTTP service is started.
   */
  public async startServerForModel(modelId: string): Promise<void> {
    const { binaryPath } = this.getWhisperKitPath()
    const modelPath = this.getModelPath(modelId)
    if (!existsSync(binaryPath)) throw new Error('WhisperKit binary not found')
    if (!existsSync(modelPath)) throw new Error(`WhisperKit model not found: ${modelId}`)
    this.readyModels.add(modelId)
  }

  public async startServer(): Promise<void> {
    await this.startServerForModel(this.currentModelId)
  }

  private stopServerForModel(modelId: string): void {
    this.readyModels.delete(modelId)
  }

  public stopServer(): void {
    this.readyModels.clear()
  }

  public async transcribe(
    audioFilePath: string,
    options: TranscriptionOptions = {},
    modelId?: string
  ): Promise<TranscriptionResult> {
    const targetModelId = modelId || this.currentModelId
    if (!this.isServerReady(targetModelId)) {
      await this.startServerForModel(targetModelId)
    }

    const inputStat = statSync(audioFilePath)
    if (!inputStat.isFile() || inputStat.size <= 0 || inputStat.size > MAX_AUDIO_BYTES) {
      throw new Error('invalid_whisper_audio_input')
    }

    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'overlay-whisper-'))
    try {
      const rawExtension = extname(audioFilePath).toLowerCase()
      const extension = /^\.[a-z0-9]{1,8}$/.test(rawExtension) ? rawExtension : '.audio'
      const temporaryAudioPath = join(temporaryDirectory, `input${extension}`)
      copyFileSync(audioFilePath, temporaryAudioPath)

      const { binaryPath, workingDir } = this.getWhisperKitPath()
      const args = [
        'transcribe',
        '--audio-path',
        temporaryAudioPath,
        '--model-path',
        this.getModelPath(targetModelId),
        '--report',
        '--report-path',
        temporaryDirectory,
        '--skip-special-tokens',
        '--without-timestamps'
      ]
      if (options.language && /^[A-Za-z-]{2,16}$/.test(options.language)) {
        args.push('--language', options.language)
      }
      if (
        typeof options.temperature === 'number' &&
        Number.isFinite(options.temperature) &&
        options.temperature >= 0 &&
        options.temperature <= 1
      ) {
        args.push('--temperature', options.temperature.toString())
      }
      if (options.prompt) args.push('--prompt', options.prompt.slice(0, 4000))
      if (this.config.verbose) args.push('--verbose')

      await execFileAsync(binaryPath, args, {
        cwd: workingDir,
        env: createLocalHelperEnvironment(),
        maxBuffer: MAX_REPORT_BYTES,
        encoding: 'utf8',
        windowsHide: true,
        killSignal: 'SIGKILL',
        timeout: options.timeout ?? 60_000
      })

      const reportPath = readdirSync(temporaryDirectory)
        .filter((name) => name.endsWith('.json'))
        .map((name) => join(temporaryDirectory, name))
        .find((candidate) => {
          const reportStat = statSync(candidate)
          return reportStat.isFile() && reportStat.size > 0 && reportStat.size <= MAX_REPORT_BYTES
        })
      if (!reportPath) throw new Error('missing_whisper_transcription_report')

      const parsed = JSON.parse(readFileSync(reportPath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || typeof (parsed as { text?: unknown }).text !== 'string') {
        throw new Error('invalid_whisper_transcription_report')
      }
      const result = parsed as { text: string; language?: unknown; duration?: unknown }
      return {
        text: result.text,
        language: typeof result.language === 'string' ? result.language : undefined,
        duration: typeof result.duration === 'number' ? result.duration : undefined
      }
    } catch (error) {
      console.error(`[WhisperKit] One-shot transcription failed for ${targetModelId}:`, {
        message: error instanceof Error ? error.message : 'unknown_error'
      })
      throw error
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  }

  public async healthCheck(modelId?: string): Promise<boolean> {
    return this.isServerReady(modelId)
  }

  public isServerReady(modelId?: string): boolean {
    return this.readyModels.has(modelId || this.currentModelId)
  }

  public getStatus(): {
    isRunning: boolean
    isReady: boolean
    config: WhisperKitConfig
    currentModel: string
    servers: Map<string, { port: number; isReady: boolean }>
  } {
    const servers = new Map<string, { port: number; isReady: boolean }>()
    for (const modelId of this.readyModels) {
      servers.set(modelId, { port: 0, isReady: true })
    }
    return {
      isRunning: this.readyModels.has(this.currentModelId),
      isReady: this.readyModels.has(this.currentModelId),
      config: this.config,
      currentModel: this.currentModelId,
      servers
    }
  }

  public async switchModel(modelId: string): Promise<void> {
    const previous = this.currentModelId
    this.currentModelId = modelId
    this.config.model = modelId
    try {
      await this.startServerForModel(modelId)
      if (previous !== 'openai_whisper-base' && previous !== modelId) {
        this.stopServerForModel(previous)
      }
    } catch (error) {
      this.currentModelId = previous
      this.config.model = previous
      throw error
    }
  }

  public getCurrentModel(): string {
    return this.currentModelId
  }

  public stopAllExceptBase(): void {
    for (const modelId of this.readyModels) {
      if (modelId !== 'openai_whisper-base') this.readyModels.delete(modelId)
    }
  }

  public async getAvailableModels(): Promise<string[]> {
    const models = new Set<string>(['openai_whisper-base'])
    for (const model of await modelDownloadService.getInstalledModels()) models.add(model)
    return [...models]
  }
}

export const whisperKitService = new WhisperKitService({
  model: 'openai_whisper-base',
  verbose: false
})

export default whisperKitService
