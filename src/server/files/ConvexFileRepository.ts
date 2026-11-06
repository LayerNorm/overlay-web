import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  ComputerArtifactCommit,
  ComputerArtifactLookup,
  ComputerArtifactManifest,
  ComputerArtifactPrepare,
  UploadedFileInput,
} from '@/shared/storage/file-publication'
import { cleanupExpiredR2UploadIntents } from '@/server/storage/r2-upload-intents'
import type {
  FileRepository,
  FileRecord,
  ExtractedDocumentPart,
  FileShareResult,
  FileStorageEntitlements,
  FileStorageProxyTarget,
  FileSubtreeStorageEntry,
  FileUploadIntentRecord,
  FileListPage,
} from './FileRepository'

export class ConvexFileRepository implements FileRepository {
  readonly storageCleanupMode = 'immediate' as const

  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async getFile(args: {
    accessToken?: string
    fileId: string
    userId: string
  }): Promise<FileRecord | null> {
    return await convex.query<FileRecord | null>('files/files:get', {
      fileId: args.fileId,
      userId: args.userId,
      serverSecret: this.serverSecret,
      ...(args.accessToken ? { accessToken: args.accessToken } : {}),
    })
  }

  async getFileByLegacyOutputId(args: {
    outputId: string
    userId: string
  }): Promise<FileRecord | null> {
    return await convex.query<FileRecord | null>('files/files:getByLegacyOutputId', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async listFiles(args: Record<string, unknown> & { userId: string }): Promise<unknown[]> {
    return await convex.query<unknown[]>('files/files:list', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async listFilesPage(args: Record<string, unknown> & { userId: string }): Promise<FileListPage> {
    try {
      const page = await convex.query<FileListPage>('files/files:listPage', {
        ...args,
        serverSecret: this.serverSecret,
      }, { throwOnError: true })
      if (!page) throw new Error('files/files:listPage returned no page')
      return page
    } catch (error) {
      // Web is deployed before Convex in the production lane. During that
      // short compatibility window, fall back to the bounded legacy query.
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('listPage') && !message.includes('Could not find public function')) {
        throw error
      }
      const data = await this.listFiles(args)
      return { data, nextCursor: null, hasMore: false }
    }
  }

  async createFile(args: Record<string, unknown> & { userId: string }): Promise<string | null> {
    return await convex.mutation<string | null>('files/files:create', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async createFileWithStorage(args: Record<string, unknown> & { userId: string }): Promise<string | null> {
    return await convex.mutation<string | null>('files/files:createWithStorage', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async commitUploadedFile(args: UploadedFileInput): Promise<string> {
    const id = await convex.mutation<string>('files/files:commitUploadByServer', {
      ...args, serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!id) throw new Error('Upload publication returned no file id')
    return id
  }

  async getComputerArtifact(args: ComputerArtifactLookup): Promise<ComputerArtifactManifest | null> {
    return await convex.query<ComputerArtifactManifest | null>('files/artifactPublications:get', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async prepareComputerArtifact(args: ComputerArtifactPrepare): Promise<ComputerArtifactManifest> {
    const manifest = await convex.mutation<ComputerArtifactManifest>('files/artifactPublications:prepare', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!manifest) throw new Error('Artifact preparation returned no manifest')
    return manifest
  }

  async commitComputerArtifact(args: ComputerArtifactCommit): Promise<string> {
    const id = await convex.mutation<string>('files/artifactPublications:commit', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!id) throw new Error('Artifact publication returned no file id')
    return id
  }

  async createExtractedDocument(args: {
    mimeType: string
    parentId?: string
    parts: ExtractedDocumentPart[]
    r2Key: string
    sourceSizeBytes: number
    userId: string
    workspaceId?: string
  }): Promise<string[]> {
    return await convex.mutation<string[]>('files/files:createExtractedDocument', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async updateFile(args: Record<string, unknown> & { fileId: string; userId: string }): Promise<void | { updatedAt: number }> {
    const updateArgs = {
      ...args,
      serverSecret: this.serverSecret,
    }
    try {
      const result = await convex.mutation<{ updatedAt: number } | null>('files/files:update', {
        ...updateArgs,
        returnRevision: true,
      }, { throwOnError: true })
      return result ?? undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/returnRevision/i.test(message) || !/ArgumentValidationError|extra field|unexpected|validator/i.test(message)) {
        throw error
      }
      await convex.mutation('files/files:update', updateArgs, { throwOnError: true })
      return undefined
    }
  }

  async removeFile(args: {
    fileId: string
    r2CleanupConfirmed?: boolean
    userId: string
  }): Promise<void> {
    await convex.mutation('files/files:remove', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async getUploadIntent(args: {
    now: number
    r2Key: string
    userId: string
  }): Promise<FileUploadIntentRecord | null> {
    return await convex.query<FileUploadIntentRecord | null>('files/files:getUploadIntentByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async createUploadIntent(args: {
    declaredSizeBytes: number
    expiresAt: number
    mimeType: string
    r2Key: string
    userId: string
  }): Promise<void> {
    await convex.mutation('files/files:createUploadIntentByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async cleanupExpiredUploadIntents(args: {
    userId: string
  }): Promise<number> {
    return cleanupExpiredR2UploadIntents({
      userId: args.userId,
      serverSecret: this.serverSecret,
    })
  }

  async finalizeUploadIntent(args: {
    actualSizeBytes: number
    fileId: string
    now: number
    r2Key: string
    userId: string
  }): Promise<void> {
    await convex.mutation('files/files:finalizeUploadIntentByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async expireUploadIntent(args: {
    intentId: string
    now: number
    userId: string
  }): Promise<void> {
    await convex.mutation('files/files:expireUploadIntentsByServer', {
      userId: args.userId,
      serverSecret: this.serverSecret,
      intentIds: [args.intentId],
      now: args.now,
    }, { throwOnError: true })
  }

  async getR2KeysForSubtree(args: {
    fileId: string
    userId: string
  }): Promise<FileSubtreeStorageEntry[]> {
    return await convex.query<FileSubtreeStorageEntry[]>('files/files:getR2KeysForSubtree', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async getStorageUrlForProxy(args: {
    fileId: string
    userId: string
  }): Promise<FileStorageProxyTarget | null> {
    return await convex.query<FileStorageProxyTarget | null>(
      'files/files:getStorageUrlForProxy',
      {
        ...args,
        serverSecret: this.serverSecret,
      },
      { throwOnError: true },
    )
  }

  async recordFileBandwidth(args: {
    bytes: number
    userId: string
  }): Promise<void> {
    await convex.mutation('platform/usage:recordFileBandwidthByServer', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async getStorageEntitlements(args: {
    userId: string
  }): Promise<FileStorageEntitlements | null> {
    return await convex.query<FileStorageEntitlements | null>('platform/usage:getEntitlementsByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async setShare(args: {
    fileId: string
    userId: string
    visibility: 'private' | 'public'
  }): Promise<FileShareResult | null> {
    return await convex.mutation<FileShareResult | null>('files/files:setShare', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }
}
