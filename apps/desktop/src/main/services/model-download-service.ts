import { app } from 'electron'
import { join, resolve } from 'path'
import { mkdir, readdir, rm, stat } from 'fs/promises'
import { createWriteStream, existsSync } from 'fs'
import axios from 'axios'
import { pipeline } from 'stream/promises'

const WHISPERKIT_REPO = 'argmaxinc/whisperkit-coreml'
const PARAKEET_REPO = 'FluidInference/parakeet-tdt-0.6b-v2-coreml'
const HUGGINGFACE_BASE_URL = 'https://huggingface.co'
const HUGGINGFACE_REVISIONS: Readonly<Record<string, string>> = {
  [WHISPERKIT_REPO]: '97a5bf9bbc74c7d9c12c755d04dea59e672e3808',
  [PARAKEET_REPO]: 'ee09c569f73759e6d44c9bd16766f477b2b36d39'
}

type ParakeetModelId = 'parakeet_v2' | 'parakeet_v3'

const PARAKEET_MODEL_FILES: Record<ParakeetModelId, string[]> = {
  parakeet_v2: [
    'Decoder.mlmodelc',
    'Encoder.mlmodelc',
    'JointDecision.mlmodelc',
    'Melspectrogram_v2.mlmodelc',
    'ParakeetEncoder_v2.mlmodelc',
    'Preprocessor.mlmodelc',
    'config.json',
    'parakeet_vocab.json'
  ],
  parakeet_v3: [
    'Melspectrogram.mlmodelc',
    'ParakeetDecoder.mlmodelc',
    'ParakeetEncoder.mlmodelc',
    'RNNTJoint.mlmodelc',
    'config.json',
    'parakeet_vocab.json'
  ]
}

const PARAKEET_FOLDER_MAP: Record<ParakeetModelId, string> = {
  parakeet_v2: 'parakeet-tdt-0.6b-v2-coreml',
  parakeet_v3: 'parakeet-tdt-0.6b-v3-coreml'
}

export interface DownloadProgress {
  modelId: string
  percent: number
  downloaded: number
  total: number
  downloadedFormatted: string
  totalFormatted: string
  currentFile: string
}

export interface ModelInfo {
  id: string
  name: string
  size: number
  sizeFormatted: string
  downloaded: boolean
  path?: string
}

interface HuggingFaceFile {
  type: 'file' | 'directory'
  path: string
  size?: number
}

class ModelDownloadService {
  private modelsBasePath: string
  private parakeetModelsBasePath: string
  private progressCallbacks: Map<string, (progress: DownloadProgress) => void> = new Map()

  constructor() {
    // Store models in Application Support directory
    this.modelsBasePath = join(app.getPath('appData'), 'Overlay', 'models', 'whisperkit-coreml')
    this.parakeetModelsBasePath = join(
      app.getPath('appData'),
      'Overlay',
      'models',
      'parakeet-coreml'
    )
  }

  /**
   * Get the WhisperKit models base path
   */
  public getModelsBasePath(): string {
    return this.modelsBasePath
  }

  /**
   * Get the Parakeet models base path
   */
  public getParakeetModelsBasePath(): string {
    return this.parakeetModelsBasePath
  }

  /**
   * Validate that a model path stays within the expected base directory
   */
  private validateModelPath(modelId: string, basePath: string): string {
    if (!modelId || modelId.includes('..') || /[/\\]/.test(modelId)) {
      throw new Error(`Invalid model ID: ${modelId}`)
    }
    const modelPath = join(basePath, modelId)
    if (!resolve(modelPath).startsWith(resolve(basePath))) {
      throw new Error(`Invalid model ID: ${modelId}`)
    }
    return modelPath
  }

  /**
   * Ensure models directory exists
   */
  private async ensureModelsDirectory(): Promise<void> {
    if (!existsSync(this.modelsBasePath)) {
      await mkdir(this.modelsBasePath, { recursive: true })
    }
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Math.round(bytes / Math.pow(k, i))} ${sizes[i]}`
  }

  /**
   * Ensure parakeet models directory exists
   */
  private async ensureParakeetModelsDirectory(): Promise<void> {
    if (!existsSync(this.parakeetModelsBasePath)) {
      await mkdir(this.parakeetModelsBasePath, { recursive: true })
    }
  }

  /**
   * Recursively list all files in a HuggingFace model folder
   */
  private async listModelFiles(
    folderPath: string,
    repo: string = WHISPERKIT_REPO
  ): Promise<HuggingFaceFile[]> {
    const revision = this.getPinnedRevision(repo)
    const apiUrl = `https://huggingface.co/api/models/${repo}/tree/${revision}/${folderPath}`
    console.log('[ModelDownload] Fetching file list from:', apiUrl)

    try {
      const response = await axios.get(apiUrl, { timeout: 30000 })
      const items: HuggingFaceFile[] = response.data

      const allFiles: HuggingFaceFile[] = []

      for (const item of items) {
        if (item.type === 'file') {
          allFiles.push(item)
        } else if (item.type === 'directory') {
          // Recursively get files in subdirectory
          const subFiles = await this.listModelFiles(item.path, repo)
          allFiles.push(...subFiles)
        }
      }

      return allFiles
    } catch (error) {
      console.error('[ModelDownload] Failed to list files:', error)
      throw new Error(`Failed to fetch model file list: ${error}`)
    }
  }

  /**
   * Download a single file from HuggingFace
   */
  private async downloadFile(
    remotePath: string,
    localPath: string,
    onProgress?: (downloaded: number) => void,
    repo: string = WHISPERKIT_REPO
  ): Promise<void> {
    const revision = this.getPinnedRevision(repo)
    const url = `${HUGGINGFACE_BASE_URL}/${repo}/resolve/${revision}/${remotePath}`
    console.log('[ModelDownload] Downloading file:', url)

    // Ensure directory exists
    const dir = join(localPath, '..')
    await mkdir(dir, { recursive: true })

    try {
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
        timeout: 120000, // 2 minute timeout per file
        maxRedirects: 5
      })

      const writer = createWriteStream(localPath)
      let downloaded = 0

      response.data.on('data', (chunk: Buffer) => {
        downloaded += chunk.length
        if (onProgress) {
          onProgress(downloaded)
        }
      })

      await pipeline(response.data, writer)
      console.log('[ModelDownload] File downloaded:', localPath)
    } catch (error) {
      console.error('[ModelDownload] Failed to download file:', error)
      // Clean up partial download
      try {
        await rm(localPath, { force: true })
      } catch {
        // Ignore cleanup errors
      }
      throw error
    }
  }

  private getPinnedRevision(repo: string): string {
    const revision = HUGGINGFACE_REVISIONS[repo]
    if (!revision || !/^[0-9a-f]{40}$/.test(revision)) {
      throw new Error(`Model repository is not pinned to an immutable revision: ${repo}`)
    }
    return revision
  }

  /**
   * Register progress callback for model download
   */
  public onProgress(modelId: string, callback: (progress: DownloadProgress) => void): void {
    this.progressCallbacks.set(modelId, callback)
  }

  /**
   * Remove progress callback
   */
  public offProgress(modelId: string): void {
    this.progressCallbacks.delete(modelId)
  }

  /**
   * Download a complete model from HuggingFace
   */
  public async downloadModel(modelId: string): Promise<void> {
    console.log('[ModelDownload] Starting download for model:', modelId)

    await this.ensureModelsDirectory()

    const modelPath = this.validateModelPath(modelId, this.modelsBasePath)

    // Check if model already exists
    if (existsSync(modelPath)) {
      console.log('[ModelDownload] Model already exists, skipping download')
      return
    }

    try {
      // Get list of all files in the model folder
      const files = await this.listModelFiles(modelId)
      console.log(`[ModelDownload] Found ${files.length} files to download`)

      const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0)
      let downloadedSize = 0

      const callback = this.progressCallbacks.get(modelId)

      // Download each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const relativePath = file.path.replace(`${modelId}/`, '')
        const localPath = join(modelPath, relativePath)

        console.log(`[ModelDownload] Downloading file ${i + 1}/${files.length}: ${relativePath}`)

        if (callback) {
          callback({
            modelId,
            percent: Math.round((downloadedSize / totalSize) * 100),
            downloaded: downloadedSize,
            total: totalSize,
            downloadedFormatted: this.formatBytes(downloadedSize),
            totalFormatted: this.formatBytes(totalSize),
            currentFile: relativePath
          })
        }

        await this.downloadFile(file.path, localPath, (fileDownloaded) => {
          if (callback) {
            callback({
              modelId,
              percent: Math.round(((downloadedSize + fileDownloaded) / totalSize) * 100),
              downloaded: downloadedSize + fileDownloaded,
              total: totalSize,
              downloadedFormatted: this.formatBytes(downloadedSize + fileDownloaded),
              totalFormatted: this.formatBytes(totalSize),
              currentFile: relativePath
            })
          }
        })

        downloadedSize += file.size || 0
      }

      // Final progress update
      if (callback) {
        callback({
          modelId,
          percent: 100,
          downloaded: totalSize,
          total: totalSize,
          downloadedFormatted: this.formatBytes(totalSize),
          totalFormatted: this.formatBytes(totalSize),
          currentFile: 'Complete'
        })
      }

      console.log('[ModelDownload] Model download completed:', modelId)
    } catch (error) {
      console.error('[ModelDownload] Model download failed:', error)
      // Clean up partial download
      try {
        await rm(modelPath, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
      throw error
    }
  }

  /**
   * Download a Parakeet model from HuggingFace
   * Parakeet models are CoreML models that only work on macOS Apple Silicon
   */
  public async downloadParakeetModel(modelId: ParakeetModelId): Promise<void> {
    console.log('[ModelDownload] Starting Parakeet download for model:', modelId)

    // Check platform - Parakeet CoreML models only work on macOS Apple Silicon
    if (process.platform !== 'darwin') {
      throw new Error('Parakeet models are only available on macOS')
    }

    await this.ensureParakeetModelsDirectory()

    const folderName = PARAKEET_FOLDER_MAP[modelId]
    const modelPath = join(this.parakeetModelsBasePath, folderName)

    // Check if model already exists
    if (existsSync(modelPath)) {
      console.log('[ModelDownload] Parakeet model already exists, skipping download')
      return
    }

    try {
      // Get list of files to download for this model version
      const filesToDownload = PARAKEET_MODEL_FILES[modelId]
      console.log(
        `[ModelDownload] Parakeet ${modelId} requires ${filesToDownload.length} components`
      )

      // Fetch file info from HuggingFace to get sizes
      const allRepoFiles = await this.listModelFiles('', PARAKEET_REPO)

      // Filter to only the files we need and calculate total size
      const files: HuggingFaceFile[] = []
      for (const fileName of filesToDownload) {
        // Find all files that match this component (handles .mlmodelc directories)
        const matchingFiles = allRepoFiles.filter(
          (f) => f.path === fileName || f.path.startsWith(`${fileName}/`)
        )
        files.push(...matchingFiles)
      }

      console.log(`[ModelDownload] Found ${files.length} files to download for Parakeet ${modelId}`)

      const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0)
      let downloadedSize = 0

      const callback = this.progressCallbacks.get(modelId)

      // Download each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const localPath = join(modelPath, file.path)

        console.log(`[ModelDownload] Downloading file ${i + 1}/${files.length}: ${file.path}`)

        if (callback) {
          callback({
            modelId,
            percent: Math.round((downloadedSize / totalSize) * 100),
            downloaded: downloadedSize,
            total: totalSize,
            downloadedFormatted: this.formatBytes(downloadedSize),
            totalFormatted: this.formatBytes(totalSize),
            currentFile: file.path
          })
        }

        await this.downloadFile(
          file.path,
          localPath,
          (fileDownloaded) => {
            if (callback) {
              callback({
                modelId,
                percent: Math.round(((downloadedSize + fileDownloaded) / totalSize) * 100),
                downloaded: downloadedSize + fileDownloaded,
                total: totalSize,
                downloadedFormatted: this.formatBytes(downloadedSize + fileDownloaded),
                totalFormatted: this.formatBytes(totalSize),
                currentFile: file.path
              })
            }
          },
          PARAKEET_REPO
        )

        downloadedSize += file.size || 0
      }

      // Final progress update
      if (callback) {
        callback({
          modelId,
          percent: 100,
          downloaded: totalSize,
          total: totalSize,
          downloadedFormatted: this.formatBytes(totalSize),
          totalFormatted: this.formatBytes(totalSize),
          currentFile: 'Complete'
        })
      }

      console.log('[ModelDownload] Parakeet model download completed:', modelId)
    } catch (error) {
      console.error('[ModelDownload] Parakeet model download failed:', error)
      // Clean up partial download
      try {
        await rm(modelPath, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
      throw error
    }
  }

  /**
   * Check if a Parakeet model is installed (in Application Support, not bundled)
   */
  public isParakeetModelInstalled(modelId: ParakeetModelId): boolean {
    const folderName = PARAKEET_FOLDER_MAP[modelId]
    const modelPath = join(this.parakeetModelsBasePath, folderName)
    return existsSync(modelPath)
  }

  /**
   * Check if a Parakeet model exists in a bundled/dev location
   * No longer used - all models are downloaded
   */
  public isParakeetModelBundled(_modelId: ParakeetModelId): boolean {
    // No models are bundled anymore - all must be downloaded
    return false
  }

  /**
   * Get list of installed Parakeet models
   */
  public async getInstalledParakeetModels(): Promise<ParakeetModelId[]> {
    const installed: ParakeetModelId[] = []
    for (const modelId of ['parakeet_v2', 'parakeet_v3'] as ParakeetModelId[]) {
      if (this.isParakeetModelInstalled(modelId)) {
        installed.push(modelId)
      }
    }
    return installed
  }

  /**
   * Delete a Parakeet model
   */
  public async deleteParakeetModel(modelId: ParakeetModelId): Promise<void> {
    const folderName = PARAKEET_FOLDER_MAP[modelId]
    const modelPath = join(this.parakeetModelsBasePath, folderName)

    if (!existsSync(modelPath)) {
      throw new Error(`Parakeet model ${modelId} is not installed`)
    }

    try {
      await rm(modelPath, { recursive: true, force: true })
      console.log('[ModelDownload] Parakeet model deleted:', modelId)
    } catch (error) {
      console.error('[ModelDownload] Failed to delete Parakeet model:', error)
      throw error
    }
  }

  /**
   * Get list of installed models
   */
  public async getInstalledModels(): Promise<string[]> {
    await this.ensureModelsDirectory()

    try {
      const entries = await readdir(this.modelsBasePath, { withFileTypes: true })
      const modelDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      return modelDirs
    } catch (error) {
      console.error('[ModelDownload] Failed to list installed models:', error)
      return []
    }
  }

  /**
   * Check if a model is installed
   */
  public async isModelInstalled(modelId: string): Promise<boolean> {
    const modelPath = this.validateModelPath(modelId, this.modelsBasePath)
    return existsSync(modelPath)
  }

  /**
   * Check if a WhisperKit model exists in a bundled/dev location
   * No longer used - all models are downloaded
   */
  public isWhisperKitModelBundled(_modelId: string): boolean {
    // No models are bundled anymore - all must be downloaded
    return false
  }

  /**
   * Delete a downloaded model
   */
  public async deleteModel(modelId: string): Promise<void> {
    const modelPath = this.validateModelPath(modelId, this.modelsBasePath)

    if (!existsSync(modelPath)) {
      throw new Error(`Model ${modelId} is not installed`)
    }

    try {
      await rm(modelPath, { recursive: true, force: true })
      console.log('[ModelDownload] Model deleted:', modelId)
    } catch (error) {
      console.error('[ModelDownload] Failed to delete model:', error)
      throw error
    }
  }

  /**
   * Get model information
   */
  public async getModelInfo(modelId: string): Promise<ModelInfo> {
    const modelPath = this.validateModelPath(modelId, this.modelsBasePath)
    const downloaded = existsSync(modelPath)

    let size = 0
    if (downloaded) {
      try {
        // Calculate directory size
        size = await this.getDirectorySize(modelPath)
      } catch (error) {
        console.error('[ModelDownload] Failed to get model size:', error)
      }
    }

    // Estimated sizes for models that aren't downloaded
    const estimatedSizes: Record<string, number> = {
      'openai_whisper-base': 150 * 1024 * 1024,
      'openai_whisper-large-v3-v20240930_turbo_632MB': 632 * 1024 * 1024,
      'openai_whisper-large-v3_947MB': 947 * 1024 * 1024
    }

    const displaySize = downloaded ? size : estimatedSizes[modelId] || 0

    return {
      id: modelId,
      name: this.getModelDisplayName(modelId),
      size: displaySize,
      sizeFormatted: this.formatBytes(displaySize),
      downloaded,
      path: downloaded ? modelPath : undefined
    }
  }

  /**
   * Get directory size recursively
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0

    try {
      const entries = await readdir(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name)

        if (entry.isDirectory()) {
          totalSize += await this.getDirectorySize(fullPath)
        } else {
          const stats = await stat(fullPath)
          totalSize += stats.size
        }
      }
    } catch (error) {
      console.error('[ModelDownload] Error calculating directory size:', error)
    }

    return totalSize
  }

  /**
   * Get display name for model
   */
  private getModelDisplayName(modelId: string): string {
    const nameMap: Record<string, string> = {
      'openai_whisper-base': 'Base',
      'openai_whisper-large-v3-v20240930_turbo_632MB': 'Turbo',
      'openai_whisper-large-v3_947MB': 'Large'
    }
    return nameMap[modelId] || modelId
  }

  /**
   * Get available disk space (rough estimate)
   */
  public async getAvailableDiskSpace(): Promise<number> {
    try {
      // Get stats for the app data directory
      // const appDataPath = app.getPath('appData') // Not used
      // This is a rough estimate - we can't easily get exact free space without native modules
      // Return a large number to avoid blocking downloads
      return 10 * 1024 * 1024 * 1024 // 10 GB
    } catch (error) {
      console.error('[ModelDownload] Failed to get disk space:', error)
      return 10 * 1024 * 1024 * 1024 // Default to 10 GB
    }
  }
}

// Export singleton instance
export const modelDownloadService = new ModelDownloadService()

export default modelDownloadService
