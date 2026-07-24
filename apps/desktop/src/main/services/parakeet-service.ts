import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { modelDownloadService } from './model-download-service'
import { createLocalHelperEnvironment } from './security/local-helper-process'

const execFileAsync = promisify(execFile)
const RESULT_MARKER = 'OVERLAY_TRANSCRIPTION_RESULT:'
const MAX_HELPER_OUTPUT_BYTES = 5 * 1024 * 1024

interface ParakeetConfig {
  model: ParakeetModelId
  verbose: boolean
}

type ParakeetModelId = 'parakeet_v2' | 'parakeet_v3'

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

const MODEL_FOLDER_MAP: Record<ParakeetModelId, string> = {
  parakeet_v2: 'parakeet-tdt-0.6b-v2-coreml',
  parakeet_v3: 'parakeet-tdt-0.6b-v3-coreml'
}

class ParakeetService {
  private readonly readyModels = new Set<ParakeetModelId>()
  private readonly config: ParakeetConfig
  private currentModelId: ParakeetModelId

  constructor(config?: Partial<ParakeetConfig>) {
    this.config = {
      model: 'parakeet_v2',
      verbose: false,
      ...config
    }
    this.currentModelId = this.config.model
  }

  private getParakeetPath(): { binaryPath: string; workingDir: string } {
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
    if (isDev) {
      const sourceWorkingDir = join(process.cwd(), 'ParakeetServer')
      const sourceBinaryPath = join(sourceWorkingDir, '.build', 'release', 'parakeet-cli')
      if (existsSync(sourceBinaryPath)) {
        return { binaryPath: sourceBinaryPath, workingDir: sourceWorkingDir }
      }
      const bundlePath = join(process.cwd(), 'parakeet-bundle')
      const bundleBinaryPath = join(bundlePath, 'parakeet-cli')
      if (existsSync(bundleBinaryPath)) {
        return { binaryPath: bundleBinaryPath, workingDir: bundlePath }
      }
      return {
        binaryPath: sourceBinaryPath,
        workingDir: sourceWorkingDir
      }
    }
    const workingDir = join(process.resourcesPath, 'parakeet')
    return { binaryPath: join(workingDir, 'parakeet-cli'), workingDir }
  }

  private getModelPath(modelId: ParakeetModelId): string {
    return join(
      modelDownloadService.getParakeetModelsBasePath(),
      MODEL_FOLDER_MAP[modelId]
    )
  }

  public isAvailable(): boolean {
    try {
      return existsSync(this.getParakeetPath().binaryPath)
    } catch {
      return false
    }
  }

  /**
   * Kept for renderer compatibility. Readiness now means the one-shot binary
   * and model are present; no localhost server is started.
   */
  public async startServerForModel(modelId: ParakeetModelId): Promise<void> {
    const { binaryPath } = this.getParakeetPath()
    const modelPath = this.getModelPath(modelId)
    if (!existsSync(binaryPath)) throw new Error('Parakeet binary not found')
    if (!existsSync(modelPath)) throw new Error(`Parakeet model not found at: ${modelPath}`)
    this.readyModels.add(modelId)
  }

  public stopServer(): void {
    this.readyModels.clear()
  }

  public isServerReady(modelId?: ParakeetModelId): boolean {
    return this.readyModels.has(modelId || this.currentModelId)
  }

  public async transcribe(
    audioFilePath: string,
    options: TranscriptionOptions = {},
    modelId?: ParakeetModelId
  ): Promise<TranscriptionResult> {
    const targetModelId = modelId || this.currentModelId
    if (!this.isServerReady(targetModelId)) {
      await this.startServerForModel(targetModelId)
    }

    const { binaryPath, workingDir } = this.getParakeetPath()
    const args = [
      '--model-path',
      this.getModelPath(targetModelId),
      '--model-version',
      targetModelId === 'parakeet_v3' ? 'v3' : 'v2',
      '--audio-path',
      audioFilePath
    ]
    if (this.config.verbose) args.push('--verbose')

    try {
      const { stdout } = await execFileAsync(binaryPath, args, {
        cwd: workingDir,
        env: createLocalHelperEnvironment(),
        maxBuffer: MAX_HELPER_OUTPUT_BYTES,
        encoding: 'utf8',
        windowsHide: true,
        killSignal: 'SIGKILL',
        timeout: options.timeout ?? 60_000
      })
      const markerIndex = stdout.lastIndexOf(RESULT_MARKER)
      if (markerIndex < 0) throw new Error('missing_transcription_result')
      const parsed = JSON.parse(stdout.slice(markerIndex + RESULT_MARKER.length).trim()) as unknown
      if (!parsed || typeof parsed !== 'object' || typeof (parsed as { text?: unknown }).text !== 'string') {
        throw new Error('invalid_transcription_result')
      }
      const result = parsed as { text: string; language?: unknown; duration?: unknown }
      return {
        text: result.text,
        language: typeof result.language === 'string' ? result.language : undefined,
        duration: typeof result.duration === 'number' ? result.duration : undefined
      }
    } catch (error) {
      console.error(`[Parakeet] One-shot transcription failed for ${targetModelId}:`, {
        message: error instanceof Error ? error.message : 'unknown_error'
      })
      throw error
    }
  }

  public async switchModel(modelId: ParakeetModelId): Promise<void> {
    const previous = this.currentModelId
    this.currentModelId = modelId
    try {
      await this.startServerForModel(modelId)
      if (previous !== modelId) this.readyModels.delete(previous)
    } catch (error) {
      this.currentModelId = previous
      throw error
    }
  }

  public getAvailableModels(): ParakeetModelId[] {
    return (['parakeet_v2', 'parakeet_v3'] as ParakeetModelId[]).filter((modelId) =>
      existsSync(this.getModelPath(modelId))
    )
  }

  public isPlatformSupported(): boolean {
    return process.platform === 'darwin'
  }
}

export const parakeetService = new ParakeetService({
  model: 'parakeet_v2',
  verbose: false
})

export default parakeetService
