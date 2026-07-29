import 'server-only'

import type { FileRepository, FileRecord } from '@/server/files/FileRepository'
import type { FileService } from '@/server/files/FileService'
import { isKnownOutputType } from '@/shared/tools/output-types'

export type OutputSource = 'image_generation' | 'video_generation' | 'browser' | 'sandbox'
export type OutputStatus = 'pending' | 'completed' | 'failed'

export type OutputRecord = {
  _id: string
  fileId: string
  legacyOutputId?: string
  userId: string
  type: string
  source: OutputSource
  status: OutputStatus
  prompt: string
  modelId: string
  r2Key?: string
  url?: string
  fileName: string
  mimeType?: string
  sizeBytes?: number
  metadata?: Record<string, unknown>
  conversationId?: string
  turnId?: string
  errorMessage?: string
  createdAt: number
  completedAt?: number
  expiresAt?: number
}

type RetentionPolicy = {
  generatedDays?: number
  sandboxDays?: number
}

export class OutputService {
  constructor(private readonly deps: {
    files: FileService
    repository: FileRepository
    retentionPolicy?: () => RetentionPolicy
  }) {}

  async create(args: {
    userId: string
    type: string
    source: OutputSource
    status: OutputStatus
    prompt: string
    modelId: string
    content?: string
    r2Key?: string
    url?: string
    fileName?: string
    mimeType?: string
    sizeBytes?: number
    metadata?: Record<string, unknown>
    conversationId?: string
    projectId?: string
    turnId?: string
  }): Promise<string> {
    if (!isKnownOutputType(args.type)) throw new Error(`Unsupported output type: ${args.type}`)
    const now = Date.now()
    const fileName = args.fileName?.trim() || `${args.type}-${now}`
    const id = await this.deps.repository.createFile({
      userId: args.userId,
      name: fileName,
      type: 'file',
      kind: 'output',
      content: args.content ?? '',
      r2Key: args.r2Key,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      conversationId: args.conversationId,
      projectId: args.projectId,
      turnId: args.turnId,
      modelId: args.modelId,
      prompt: args.prompt,
      outputType: args.type,
      outputSource: args.source,
      outputStatus: args.status,
      outputUrl: args.url,
      outputMetadata: args.metadata,
      outputCompletedAt: args.status === 'pending' ? undefined : now,
      expiresAt: this.expiryFor(args.source, now),
      createdAt: now,
      updatedAt: now,
    })
    if (!id) throw new Error('Output record was not created.')
    return id
  }

  async update(args: {
    outputId: string
    userId: string
    status?: OutputStatus
    r2Key?: string
    url?: string
    modelId?: string
    type?: string
    source?: OutputSource
    fileName?: string
    mimeType?: string
    sizeBytes?: number
    metadata?: Record<string, unknown>
    errorMessage?: string
  }): Promise<void> {
    const existing = await this.getCanonicalFile(args.outputId, args.userId)
    if (!existing || existing.kind !== 'output') throw new Error('Output not found')
    if (args.type !== undefined && !isKnownOutputType(args.type)) {
      throw new Error(`Unsupported output type: ${args.type}`)
    }
    const completedAt = args.status === 'completed' || args.status === 'failed'
      ? Date.now()
      : undefined
    await this.deps.repository.updateFile({
      fileId: existing._id,
      userId: args.userId,
      ...(args.status !== undefined ? { outputStatus: args.status } : {}),
      ...(args.r2Key !== undefined ? { r2Key: args.r2Key } : {}),
      ...(args.url !== undefined ? { outputUrl: args.url } : {}),
      ...(args.modelId !== undefined ? { modelId: args.modelId } : {}),
      ...(args.type !== undefined ? { outputType: args.type } : {}),
      ...(args.source !== undefined ? { outputSource: args.source } : {}),
      ...(args.fileName !== undefined ? { name: args.fileName } : {}),
      ...(args.mimeType !== undefined ? { mimeType: args.mimeType } : {}),
      ...(args.sizeBytes !== undefined ? { sizeBytes: args.sizeBytes } : {}),
      ...(args.metadata !== undefined ? { outputMetadata: args.metadata } : {}),
      ...(args.errorMessage !== undefined ? { outputErrorMessage: args.errorMessage } : {}),
      ...(completedAt !== undefined ? { outputCompletedAt: completedAt } : {}),
    })
  }

  async get(args: { outputId: string; userId: string }): Promise<OutputRecord | null> {
    const file = await this.getCanonicalFile(args.outputId, args.userId)
    return file?.kind === 'output' ? normalizeOutput(file) : null
  }

  async list(args: {
    conversationId?: string | null
    type?: string | null
    userId: string
  }): Promise<OutputRecord[]> {
    const files = await this.deps.repository.listFiles({
      userId: args.userId,
      kind: 'output',
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      ...(args.type ? { outputType: args.type } : {}),
    }) as FileRecord[]
    return files
      .filter((file) => file.kind === 'output')
      .map(normalizeOutput)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async delete(args: { outputId: string; userId: string }): Promise<void> {
    const file = await this.getCanonicalFile(args.outputId, args.userId)
    if (!file || file.kind !== 'output') throw new Error('Output not found')
    await this.deps.files.deleteFile({ fileId: file._id, userId: args.userId })
  }

  async content(args: { outputId: string; userId: string }) {
    const file = await this.getCanonicalFile(args.outputId, args.userId)
    if (!file || file.kind !== 'output') return { kind: 'json' as const, payload: { error: 'Not found' }, status: 404 }
    return await this.deps.files.getContentProxy({ fileId: file._id, userId: args.userId })
  }

  async share(args: {
    origin: string
    outputId: string
    userId: string
    visibility: 'private' | 'public'
  }) {
    const file = await this.getCanonicalFile(args.outputId, args.userId)
    if (!file || file.kind !== 'output') throw new Error('Output not found')
    return await this.deps.files.setShare({
      fileId: file._id,
      origin: args.origin,
      userId: args.userId,
      visibility: args.visibility,
    })
  }

  private async getCanonicalFile(outputId: string, userId: string): Promise<FileRecord | null> {
    const direct = await this.deps.repository.getFile({ fileId: outputId, userId }).catch((_error) => null)
    if (direct?.kind === 'output') return direct
    return await this.deps.repository.getFileByLegacyOutputId({ outputId, userId }).catch((_error) => null)
  }

  private expiryFor(source: OutputSource, now: number): number | undefined {
    const policy = this.deps.retentionPolicy?.() ?? {}
    const days = source === 'sandbox' ? policy.sandboxDays : policy.generatedDays
    return days ? now + days * 24 * 60 * 60_000 : undefined
  }
}

function normalizeOutput(file: FileRecord): OutputRecord {
  const type = stringField(file.outputType) ?? 'other'
  const source = outputSource(file.outputSource, type)
  const status = outputStatus(file.outputStatus)
  const storageUrl = file.r2Key || file.storageId
    ? `/api/v1/files/${file._id}/content`
    : stringField(file.outputUrl)
  return {
    _id: file._id,
    fileId: file._id,
    legacyOutputId: stringField(file.legacyOutputId),
    userId: file.userId,
    type,
    source,
    status,
    prompt: stringField(file.prompt) ?? file.name,
    modelId: stringField(file.modelId) ?? '',
    r2Key: file.r2Key,
    url: storageUrl,
    fileName: file.name,
    mimeType: stringField(file.mimeType),
    sizeBytes: numberField(file.sizeBytes),
    metadata: recordField(file.outputMetadata),
    conversationId: stringField(file.conversationId),
    turnId: stringField(file.turnId),
    errorMessage: stringField(file.outputErrorMessage),
    createdAt: numberField(file.createdAt) ?? 0,
    completedAt: numberField(file.outputCompletedAt) ?? (status === 'pending' ? undefined : numberField(file.updatedAt)),
    expiresAt: numberField(file.expiresAt),
  }
}

function outputSource(value: unknown, type: string): OutputSource {
  if (value === 'image_generation' || value === 'video_generation' || value === 'browser' || value === 'sandbox') return value
  return type === 'image' ? 'image_generation' : type === 'video' ? 'video_generation' : 'sandbox'
}

function outputStatus(value: unknown): OutputStatus {
  return value === 'pending' || value === 'failed' ? value : 'completed'
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
