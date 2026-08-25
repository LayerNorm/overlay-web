import { logger } from '@/server/observability/logger'
import { posix as pathPosix } from 'node:path'
import type { SandboxInstance } from '@overlay/sandbox-runtime'
import { classifyOutputType } from '@/shared/tools/output-types'
import { keyForOutput } from '@/server/storage/storage-keys'
import {
  MAX_ARTIFACT_BYTES,
  guessMimeType,
  resolveExpectedOutputPath,
  sanitizeFileName,
} from './request'

export interface OverlayFileRecord {
  _id: string
  name: string
  content: string
  storageId?: string | null
  r2Key?: string | null
}

export interface SandboxArtifactResponse {
  outputId: string
  fileName: string
  mimeType?: string
  sizeBytes?: number
  url?: string
  type: string
}

export interface SandboxRunPaths {
  inputDir: string
  outputDir: string
  rootDir: string
  runDir: string
  stderrPath: string
  stdoutPath: string
}

export interface DaytonaExecutionResult {
  exitCode: number
  stdout: string
  stderr: string
}

export async function stageDaytonaInputFiles(params: {
  fileIds: string[] | undefined
  findFile(fileId: string): Promise<OverlayFileRecord | null>
  paths: Pick<SandboxRunPaths, 'inputDir'>
  readFileBuffer(file: OverlayFileRecord): Promise<Buffer>
  sandbox: SandboxInstance
  uploadBuffer(sandbox: SandboxInstance, remotePath: string, contents: Buffer): Promise<void>
}): Promise<Array<{ fileId: string; fileName: string; sandboxPath: string }>> {
  const uploadedFiles: Array<{ fileId: string; fileName: string; sandboxPath: string }> = []
  const seenNames = new Map<string, number>()

  for (const rawFileId of params.fileIds ?? []) {
    const fileId = rawFileId.trim()
    if (!fileId) continue

    const file = await params.findFile(fileId)
    if (!file) throw new Error(`Overlay file not found: ${fileId}`)

    const finalName = uniqueSandboxFileName(
      sanitizeFileName(file.name, `input-${uploadedFiles.length + 1}`),
      seenNames,
    )
    const sandboxPath = pathPosix.join(params.paths.inputDir, finalName)
    await params.uploadBuffer(params.sandbox, sandboxPath, await params.readFileBuffer(file))
    uploadedFiles.push({ fileId, fileName: finalName, sandboxPath })
  }

  return uploadedFiles
}

export async function stageInlineCodeFile(params: {
  code?: string
  paths: Pick<SandboxRunPaths, 'runDir'>
  runtime: 'node' | 'python'
  sandbox: SandboxInstance
  uploadBuffer(sandbox: SandboxInstance, remotePath: string, contents: string): Promise<void>
}): Promise<string | undefined> {
  if (typeof params.code !== 'string' || params.code.length === 0) return undefined
  const inlineCodePath = pathPosix.join(params.paths.runDir, params.runtime === 'node' ? 'main.js' : 'main.py')
  await params.uploadBuffer(params.sandbox, inlineCodePath, params.code)
  return inlineCodePath
}

export async function collectDaytonaArtifacts(params: {
  checkGlobalBudget(sizeBytes: number): Promise<void>
  command: string
  conversationId?: string
  createOutput(args: Record<string, unknown>): Promise<string | null>
  deleteObject(key: string): Promise<void>
  downloadFile(sandbox: SandboxInstance, remotePath: string): Promise<Buffer>
  expectedOutputs: string[]
  findSandboxFile(sandbox: SandboxInstance, remotePath: string): Promise<{ isDir?: boolean } | null>
  paths: Pick<SandboxRunPaths, 'rootDir'>
  runtime: 'node' | 'python'
  sandbox: SandboxInstance
  serverSecret: string
  task: string
  turnId?: string
  uploadObject(key: string, body: Uint8Array, mimeType: string): Promise<void>
  userId: string
}): Promise<{ artifacts: SandboxArtifactResponse[]; missingExpectedOutputs: string[] }> {
  const artifacts: SandboxArtifactResponse[] = []
  const missingExpectedOutputs: string[] = []

  for (const rawExpected of params.expectedOutputs) {
    const remotePath = resolveExpectedOutputPath(params.paths.rootDir, rawExpected)
    const details = await params.findSandboxFile(params.sandbox, remotePath)
    if (!details || details.isDir) {
      missingExpectedOutputs.push(rawExpected)
      continue
    }
    artifacts.push(await importDaytonaArtifact({
      ...params,
      artifactIndex: artifacts.length,
      rawExpected,
      remotePath,
    }))
  }

  return { artifacts, missingExpectedOutputs }
}

export function buildDaytonaRunResult(params: {
  artifacts: SandboxArtifactResponse[]
  execution: DaytonaExecutionResult
  missingExpectedOutputs: string[]
  sandboxId: string
  uploadedFiles: Array<{ fileId: string; fileName: string; sandboxPath: string }>
  workspaceState: string
}): { payload: Record<string, unknown>; status: number } {
  const exportSucceeded =
    params.execution.exitCode === 0 &&
    params.artifacts.length > 0 &&
    params.missingExpectedOutputs.length === 0

  return {
    status: exportSucceeded ? 200 : 500,
    payload: {
      success: exportSucceeded,
      exitCode: params.execution.exitCode,
      stdout: params.execution.stdout,
      stderr: params.execution.stderr,
      artifacts: params.artifacts,
      missingExpectedOutputs: params.missingExpectedOutputs,
      uploadedFiles: params.uploadedFiles,
      sandboxId: params.sandboxId,
      workspaceState: params.workspaceState,
      message: daytonaResultMessage({
        artifactCount: params.artifacts.length,
        exitCode: params.execution.exitCode,
        missingExpectedOutputs: params.missingExpectedOutputs,
      }),
    },
  }
}

async function importDaytonaArtifact(params: {
  artifactIndex: number
  checkGlobalBudget(sizeBytes: number): Promise<void>
  command: string
  conversationId?: string
  createOutput(args: Record<string, unknown>): Promise<string | null>
  deleteObject(key: string): Promise<void>
  downloadFile(sandbox: SandboxInstance, remotePath: string): Promise<Buffer>
  rawExpected: string
  remotePath: string
  runtime: 'node' | 'python'
  sandbox: SandboxInstance
  serverSecret: string
  task: string
  turnId?: string
  uploadObject(key: string, body: Uint8Array, mimeType: string): Promise<void>
  userId: string
}): Promise<SandboxArtifactResponse> {
  const artifactBuffer = await params.downloadFile(params.sandbox, params.remotePath)
  if (artifactBuffer.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error(`Sandbox artifact "${params.rawExpected}" exceeds the ${MAX_ARTIFACT_BYTES} byte limit.`)
  }
  const fileName = sanitizeFileName(pathPosix.basename(params.remotePath), `artifact-${params.artifactIndex + 1}`)
  const mimeType = guessMimeType(fileName, artifactBuffer)
  const type = classifyOutputType(fileName, mimeType)
  const r2Key = keyForOutput(params.userId, `tmp-${Date.now()}`, fileName)
  await params.checkGlobalBudget(artifactBuffer.byteLength)
  await params.uploadObject(r2Key, new Uint8Array(artifactBuffer), mimeType ?? 'application/octet-stream')
  logger.info(`[Daytona] Uploaded artifact "${fileName}" (${artifactBuffer.byteLength}B) to R2 key=${r2Key}`)

  const outputId = await createOutputOrCleanup({
    ...params,
    artifactBuffer,
    fileName,
    mimeType,
    r2Key,
    type,
  })
  return { outputId, fileName, mimeType, sizeBytes: artifactBuffer.byteLength, type }
}

async function createOutputOrCleanup(params: {
  artifactBuffer: Buffer
  command: string
  conversationId?: string
  createOutput(args: Record<string, unknown>): Promise<string | null>
  deleteObject(key: string): Promise<void>
  fileName: string
  mimeType?: string
  r2Key: string
  remotePath: string
  runtime: 'node' | 'python'
  serverSecret: string
  task: string
  turnId?: string
  type: string
  userId: string
}): Promise<string> {
  try {
    const createdOutputId = await params.createOutput({
      userId: params.userId,
      serverSecret: params.serverSecret,
      type: params.type,
      source: 'sandbox',
      status: 'completed',
      prompt: params.task,
      modelId: 'daytona/default',
      r2Key: params.r2Key,
      fileName: params.fileName,
      mimeType: params.mimeType,
      sizeBytes: params.artifactBuffer.byteLength,
      metadata: {
        runtime: params.runtime,
        command: params.command,
        remotePath: params.remotePath,
      },
      ...(params.conversationId ? { conversationId: params.conversationId } : {}),
      ...(params.turnId ? { turnId: params.turnId } : {}),
    })
    if (createdOutputId) return createdOutputId
  } catch (error) {
    await params.deleteObject(params.r2Key).catch((_error) => undefined)
    throw error
  }
  await params.deleteObject(params.r2Key).catch((_error) => undefined)
  throw new Error(`Failed to create Output record for sandbox artifact "${params.fileName}".`)
}

function daytonaResultMessage(params: {
  artifactCount: number
  exitCode: number
  missingExpectedOutputs: string[]
}): string {
  if (params.exitCode !== 0) return `Sandbox run failed with exit code ${params.exitCode}.`
  if (params.missingExpectedOutputs.length > 0) {
    return `Sandbox run completed, but some declared outputs were missing: ${params.missingExpectedOutputs.join(', ')}.`
  }
  if (params.artifactCount > 0) {
    return `Sandbox run completed and imported ${params.artifactCount} artifact${params.artifactCount === 1 ? '' : 's'}.`
  }
  return 'Sandbox run completed, but no declared output files were found.'
}

function uniqueSandboxFileName(fileName: string, seenNames: Map<string, number>): string {
  const seenCount = seenNames.get(fileName) ?? 0
  seenNames.set(fileName, seenCount + 1)
  return seenCount === 0 ? fileName : `${seenCount + 1}-${fileName}`
}
